declare module '*.vue' {
	import { DefineComponent } from 'vue';
	const component: DefineComponent<{}, {}, any>;
	export default component;
}

declare module 'directus:api' {
	export interface SandboxRequestResponse {
		status: number;
		statusText: string;
		headers: Record<string, string>;
		data: string | Record<string, unknown>;
	}

	export interface SandboxOperationConfig {
		id: string;
		handler: (data: Record<string, unknown>) => unknown | Promise<unknown>;
	}

	export const request: (
		url: string,
		options: {
			method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
			body?: Record<string, unknown> | string;
			headers?: Record<string, string>;
		},
	) => Promise<SandboxRequestResponse>;

	export const log: (message: string) => void;
}
