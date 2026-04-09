/**
 * TASKUL エコシステム共通 認証コア
 * canonical source — 各モジュールは symlink 経由で参照
 *
 * 使い方:
 *   import { createAuth } from './taskul-shared/auth-core';
 *   export const { initSession, loginWithEmail, ... } = createAuth({
 *     onSessionReady: async (userId, tenantId) => { ... },
 *   });
 */
import { browser } from '$app/environment';
import {
	supabase,
	SUPABASE_URL,
	SUPABASE_ANON_KEY,
	isDev,
	getAppUrl,
} from './supabase-core';
import {
	currentUser,
	currentTenantId,
	isAdmin,
	isWoffLogin,
	isAuthReady,
	type AppUser,
} from './stores/auth';

// ── 型定義 ──

export interface AuthHooks {
	/** セッション確立後に呼ばれる（モジュール固有の初期化用） */
	onSessionReady?: (userId: string, tenantId: number) => Promise<void>;
}

// ── localStorage キー（全モジュール共通） ──

const SK = () => (isDev() ? 'taskul_at_dev' : 'taskul_at');
const RK = () => (isDev() ? 'taskul_rt_dev' : 'taskul_rt');

function saveSession(session: { access_token: string; refresh_token: string }) {
	try {
		localStorage.setItem(SK(), session.access_token);
		localStorage.setItem(RK(), session.refresh_token);
	} catch (_) {}
}

function clearSessionTokens() {
	if (!browser) return;
	try {
		localStorage.removeItem(SK());
		localStorage.removeItem(RK());
	} catch (_) {}
}

// ── クロスオリジン SSO ──

/**
 * URL からSSO トークンを抽出（受信側）
 * クエリパラメータ（?sso_at=...）→ ハッシュ（#sso_at=...）の順で検索
 */
function consumeSsoTokens(): { at: string; rt: string } | null {
	if (!browser) return null;

	// 1. クエリパラメータから取得（WOFF内ブラウザ対応）
	const searchParams = new URLSearchParams(location.search);
	let at = searchParams.get('sso_at');
	let rt = searchParams.get('sso_rt');
	if (at && rt) {
		// クエリパラメータを即消去（トークンをURL履歴に残さない）
		history.replaceState(null, '', location.pathname);
		return { at, rt };
	}

	// 2. フォールバック: ハッシュから取得（PC版互換）
	const hash = location.hash;
	if (!hash.includes('sso_at=')) return null;
	const hashParams = new URLSearchParams(hash.slice(1));
	at = hashParams.get('sso_at');
	rt = hashParams.get('sso_rt');
	history.replaceState(null, '', location.pathname + location.search);
	if (at && rt) return { at, rt };
	return null;
}

/**
 * 他モジュールへ SSO 遷移（送信側）
 * @param appId - ECOSYSTEM_APPS のキー（'shift', 'hr', 'taskul'）
 * @param path  - 遷移先パス（デフォルト: '/app'）
 */
function navigateTo(appId: string, path = '/app') {
	const at = localStorage.getItem(SK());
	const rt = localStorage.getItem(RK());
	const base = getAppUrl(appId) + path;
	if (at && rt) {
		window.open(
			`${base}#sso_at=${encodeURIComponent(at)}&sso_rt=${encodeURIComponent(rt)}`,
			'_blank'
		);
	} else {
		window.open(base, '_blank');
	}
}

// ── 内部ヘルパー ──

async function loadTenantId(userId: string, hooks?: AuthHooks) {
	const { data } = await supabase
		.from('tenant_members')
		.select('tenant_id')
		.eq('user_id', userId)
		.maybeSingle();
	if (data?.tenant_id) {
		currentTenantId.set(data.tenant_id);
		// モジュール固有のフック呼び出し
		if (hooks?.onSessionReady) {
			await hooks.onSessionReady(userId, data.tenant_id);
		}
	}
}

async function loadAdminRole(userId: string) {
	const { data } = await supabase
		.from('org_members')
		.select('role')
		.eq('user_id', userId)
		.eq('role', 'master')
		.limit(1);
	isAdmin.set((data?.length ?? 0) > 0);
}

async function resolveUser(
	session: { user: { id: string; email?: string } },
	hooks?: AuthHooks
): Promise<boolean> {
	// auth_id で検索
	const { data: user } = await supabase
		.from('users')
		.select('*')
		.eq('auth_id', session.user.id)
		.maybeSingle();

	if (user) {
		currentUser.set(user);
		await loadTenantId(user.id, hooks);
		await loadAdminRole(user.id);
		return true;
	}

	// フォールバック: email で検索
	if (session.user?.email) {
		const { data: user2 } = await supabase
			.from('users')
			.select('*')
			.eq('email', session.user.email)
			.maybeSingle();
		if (user2) {
			if (!user2.auth_id) {
				await supabase.from('users').update({ auth_id: session.user.id }).eq('id', user2.id);
			}
			currentUser.set({ ...user2, auth_id: session.user.id });
			await loadTenantId(user2.id, hooks);
			await loadAdminRole(user2.id);
			return true;
		}
	}

	return false;
}

// ── createAuth ──

export function createAuth(hooks?: AuthHooks) {
	/**
	 * WOFF（LINE WORKS）自動ログイン
	 */
	async function tryWoffLogin(): Promise<true | false | null> {
		if (!browser) return false;
		try {
			if (typeof (window as any).woff === 'undefined') {
				await new Promise<void>((resolve) => {
					const s = document.createElement('script');
					s.src = 'https://static.worksmobile.net/static/wm/woff/edge/3.6/sdk.js';
					s.onload = () => resolve();
					s.onerror = () => resolve();
					document.head.appendChild(s);
				});
			}

			const woff = (window as any).woff;
			if (!woff) return false;

			const woffId = isDev() ? 'bthr5fNolL7gx96noEJbbQ' : '2sGuLQU8T2BvJXN88QeCIg';
			await woff.init({ woffId });
			if (!woff.isInClient()) return false;

			try {
				await supabase.auth.signOut();
			} catch (_) {}
			clearSessionTokens();

			const profile = await woff.getProfile();
			const lwUserId: string = profile.userId;
			const displayName: string = profile.displayName || lwUserId;

			const fnUrl = `${SUPABASE_URL}/functions/v1/woff-login`;
			const fnRes = await fetch(fnUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					apikey: SUPABASE_ANON_KEY,
					Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
				},
				body: JSON.stringify({ lw_user_id: lwUserId, display_name: displayName }),
			});
			const fnData = await fnRes.json();

			if (!fnRes.ok || !fnData.access_token) return null;

			await supabase.auth.setSession({
				access_token: fnData.access_token,
				refresh_token: fnData.refresh_token,
			});

			const user: AppUser = fnData.user;
			currentUser.set(user);
			isWoffLogin.set(true);
			await loadTenantId(user.id, hooks);
			await loadAdminRole(user.id);

			return true;
		} catch (e) {
			console.warn('[WOFF] error:', e);
			return false;
		}
	}

	/**
	 * 通常セッション初期化（SSO ハッシュ自動処理含む）
	 */
	async function initSession(): Promise<boolean> {
		if (!browser) return false;

		// ── クロスオリジン SSO: ハッシュからトークンを復元 ──
		const sso = consumeSsoTokens();
		if (sso) {
			const { data } = await supabase.auth.setSession({
				access_token: sso.at,
				refresh_token: sso.rt,
			});
			const session = data?.session ?? null;
			if (session) {
				saveSession(session);
				const ok = await resolveUser(session, hooks);
				if (ok) {
					isAuthReady.set(true);
					return true;
				}
			}
		}

		// ── 通常セッション復元 ──
		let session = (await supabase.auth.getSession()).data?.session ?? null;

		if (!session) {
			const at = localStorage.getItem(SK());
			const rt = localStorage.getItem(RK());
			if (at && rt) {
				const { data } = await supabase.auth.setSession({ access_token: at, refresh_token: rt });
				session = data?.session ?? null;
				if (session) saveSession(session);
				else clearSessionTokens();
			}
		}

		if (!session) {
			isAuthReady.set(true);
			return false;
		}

		saveSession(session);
		const ok = await resolveUser(session, hooks);
		isAuthReady.set(true);
		return ok;
	}

	/**
	 * メール/パスワードログイン
	 */
	async function loginWithEmail(
		email: string,
		password: string
	): Promise<string | null> {
		clearSessionTokens();
		await supabase.auth.signOut();

		const { data: authData, error } = await supabase.auth.signInWithPassword({
			email,
			password,
		});
		if (error) {
			const msg = error.message || '';
			if (msg.includes('rate') || msg.includes('Rate')) {
				return '試行回数が多すぎます。しばらく待ってから再試行してください。';
			}
			return 'メールアドレスまたはパスワードが正しくありません';
		}

		const { data: user } = await supabase
			.from('users')
			.select('*')
			.eq('auth_id', authData.user.id)
			.maybeSingle();

		if (!user) {
			await supabase.auth.signOut();
			return 'ユーザー情報が見つかりません。管理者にお問い合わせください。';
		}

		currentUser.set(user);
		saveSession(authData.session!);
		await loadTenantId(user.id, hooks);
		await loadAdminRole(user.id);
		return null;
	}

	/**
	 * ログアウト
	 */
	async function logout() {
		clearSessionTokens();
		currentUser.set(null);
		currentTenantId.set(null);
		isAdmin.set(false);
		isWoffLogin.set(false);
		await supabase.auth.signOut();
	}

	return {
		tryWoffLogin,
		initSession,
		loginWithEmail,
		logout,
		clearSession: clearSessionTokens,
		navigateTo,
	};
}

// re-export stores for convenience
export {
	currentUser,
	currentTenantId,
	isAdmin,
	isWoffLogin,
	isAuthReady,
	type AppUser,
} from './stores/auth';
