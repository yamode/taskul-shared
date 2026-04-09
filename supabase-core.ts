/**
 * TASKUL エコシステム共通 Supabase クライアント
 * canonical source — 各モジュールは symlink 経由で参照
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { browser } from '$app/environment';

// ── 環境判定（全モジュール共通） ──

export function isDev(): boolean {
	if (browser) {
		return (
			location.hostname.startsWith('dev.') ||
			location.hostname === 'localhost' ||
			location.pathname.startsWith('/dev/')
		);
	}
	return true; // SSR: default to dev
}

// ── Supabase 接続情報（TASKUL と全モジュールで共有） ──

const DEV_URL = 'https://ymevcpwgmrvtgeaganfv.supabase.co';
const DEV_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltZXZjcHdnbXJ2dGdlYWdhbmZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NTQxODYsImV4cCI6MjA5MDQzMDE4Nn0.Zo62iVw1hCWIw-c0r8WzkDIjj13ROUhFZnZlTeOi8y4';

const PROD_URL = 'https://ynzpjdarpfaurzomrddu.supabase.co';
const PROD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InluenBqZGFycGZhdXJ6b21yZGR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMzE1NzEsImV4cCI6MjA4OTkwNzU3MX0.p6KqO4YC2YBAULUqH7ZWPr6mZk0A7CtxG9F-up3ira4';

export const SUPABASE_URL = isDev() ? DEV_URL : PROD_URL;
export const SUPABASE_ANON_KEY = isDev() ? DEV_KEY : PROD_KEY;

// ── Supabase クライアント（シングルトン） ──

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
	auth: {
		persistSession: browser,
		autoRefreshToken: browser,
		detectSessionInUrl: browser,
		// 全モジュールで同じ storageKey → 同一オリジン内ではセッション共有
		storageKey: isDev() ? 'task-matrix-auth-dev' : 'task-matrix-auth',
	},
});

export type { Session, User } from '@supabase/supabase-js';

// ── エコシステムアプリ定義 ──

export interface EcosystemApp {
	id: string;
	devUrl: string;
	prodUrl: string;
}

export const ECOSYSTEM_APPS: Record<string, EcosystemApp> = {
	taskul: {
		id: 'taskul',
		devUrl: 'https://dev.taskul.pages.dev',
		prodUrl: 'https://taskul.yamado.app',
	},
	hr: {
		id: 'hr',
		devUrl: 'https://dev.taskul-hr.pages.dev',
		prodUrl: 'https://taskul-hr.yamado.app',
	},
	shift: {
		id: 'shift',
		devUrl: 'https://dev.taskul-shift.pages.dev',
		prodUrl: 'https://taskul-shift.yamado.app',
	},
};

/** エコシステムアプリのURLを取得 */
export function getAppUrl(appId: string): string {
	const app = ECOSYSTEM_APPS[appId];
	if (!app) throw new Error(`Unknown app: ${appId}`);
	return isDev() ? app.devUrl : app.prodUrl;
}
