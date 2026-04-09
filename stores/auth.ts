/**
 * TASKUL エコシステム共通 認証ストア
 * canonical source — 各モジュールは symlink 経由で参照
 */
import { writable } from 'svelte/store';

/** users テーブルの行型（最低限の共通フィールド） */
export interface AppUser {
	id: string;
	auth_id?: string;
	tenant_id?: number;
	name?: string;
	name_kana?: string;
	display_name?: string;
	email?: string;
	lw_user_id?: string;
	lw_enabled?: boolean;
	preferred_locale?: string;
	[key: string]: unknown;
}

export const currentUser = writable<AppUser | null>(null);
export const currentTenantId = writable<number | null>(null);
export const isAdmin = writable(false);
export const isWoffLogin = writable(false);
export const isAuthReady = writable(false);
