import { defineOperationApi } from '@directus/extensions-sdk';

type Options = {
	service: FirebaseService;
	method: string;
	auth?: string | Record<string, unknown>;
	resource?: string | number;
	secondaryResource?: string | number;
	payload?: string | Record<string, unknown> | Record<string, unknown>[];
};

type FirebaseService = 'firestore' | 'messaging' | 'storage' | 'remoteConfig';

type ServiceAccountShape = {
	type: string;
	project_id: string;
	private_key_id: string;
	private_key: string;
	client_email: string;
	client_id: string;
	auth_uri: string;
	token_uri: string;
	auth_provider_x509_cert_url: string;
	client_x509_cert_url: string;
	universe_domain: string;
};

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

const envCredentialMap = {
	type: 'FIREBASE_SDK_AUTH_TYPE',
	project_id: 'FIREBASE_SDK_AUTH_PROJECT_ID',
	private_key_id: 'FIREBASE_SDK_AUTH_PRIVATE_KEY_ID',
	private_key: 'FIREBASE_SDK_AUTH_PRIVATE_KEY',
	client_email: 'FIREBASE_SDK_AUTH_CLIENT_EMAIL',
	client_id: 'FIREBASE_SDK_AUTH_CLIENT_ID',
	auth_uri: 'FIREBASE_SDK_AUTH_AUTH_URI',
	token_uri: 'FIREBASE_SDK_AUTH_TOKEN_URI',
	auth_provider_x509_cert_url: 'FIREBASE_SDK_AUTH_PROVIDER_X509_CERT_URL',
	client_x509_cert_url: 'FIREBASE_SDK_AUTH_CLIENT_X509_CERT_URL',
	universe_domain: 'FIREBASE_SDK_AUTH_UNIVERSAL_DOMAIN',
} as const;

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_BASE_URL = 'https://firestore.googleapis.com/v1';
const FCM_BASE_URL = 'https://fcm.googleapis.com/v1';
const REMOTE_CONFIG_BASE_URL = 'https://firebaseremoteconfig.googleapis.com/v1';
const STORAGE_BASE_URL = 'https://storage.googleapis.com/storage/v1';

function parseJson<T>(value: unknown, fieldName: string): T | undefined {
	if (value === undefined || value === null) return undefined;

	if (typeof value !== 'string') {
		return value as T;
	}

	if (typeof value === 'string' && value.trim() === '') return undefined;

	try {
		return JSON.parse(value) as T;
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown JSON parsing error';
		throw new Error(`${fieldName} must contain valid JSON. ${message}`);
	}
}

function readEnv(name: string): string | undefined {
	const globalProcess = globalThis as { process?: { env?: Record<string, string | undefined> } };
	return globalProcess.process?.env?.[name];
}

function readCredentialsFromEnv(): Partial<ServiceAccountShape> {
	const credentials: Partial<ServiceAccountShape> = {};

	for (const [key, envName] of Object.entries(envCredentialMap)) {
		const value = readEnv(envName);

		if (!value) continue;

		credentials[key as keyof ServiceAccountShape] = key === 'private_key' ? value.replace(/\\n/g, '\n') : value;
	}

	return credentials;
}

function resolveCredentials(auth: string | Record<string, unknown> | undefined): ServiceAccountShape {
	const provided = parseJson<Partial<ServiceAccountShape>>(auth, 'Auth JSON') ?? {};
	const merged = {
		...readCredentialsFromEnv(),
		...provided,
	};

	const requiredKeys = Object.keys(envCredentialMap) as Array<keyof ServiceAccountShape>;
	const missingKeys = requiredKeys.filter((key) => !merged[key]);

	if (missingKeys.length > 0) {
		throw new Error(`Missing Firebase credentials: ${missingKeys.join(', ')}`);
	}

	return merged as ServiceAccountShape;
}

function requireResource(resource: string | undefined, label = 'Resource'): string {
	if (!resource || resource.trim() === '') {
		throw new Error(`${label} is required for this Firebase call.`);
	}

	return resource;
}

function normalizeOptionalString(value: string | number | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim();
	return String(value);
}

function normalizeRequiredString(value: string | number | undefined, label = 'Resource'): string {
	const normalized = normalizeOptionalString(value);

	if (!normalized) {
		throw new Error(`${label} is required for this Firebase call.`);
	}

	return normalized;
}

function stringToBytes(value: string): number[] {
	return Array.from(new TextEncoder().encode(value));
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';

	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

async function signJwt(unsignedToken: string, privateKeyPem: string): Promise<string> {
	const pemContents = privateKeyPem
		.replace('-----BEGIN PRIVATE KEY-----', '')
		.replace('-----END PRIVATE KEY-----', '')
		.replace(/\s+/g, '');

	const keyBytes = Uint8Array.from(atob(pemContents), (char) => char.charCodeAt(0));
	const cryptoKey = await crypto.subtle.importKey(
		'pkcs8',
		keyBytes.buffer,
		{
			name: 'RSASSA-PKCS1-v1_5',
			hash: 'SHA-256',
		},
		false,
		['sign'],
	);

	const signatureBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new Uint8Array(stringToBytes(unsignedToken)));
	return `${unsignedToken}.${bytesToBase64Url(new Uint8Array(signatureBuffer))}`;
}

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type RequestResponse = {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	data: string | Record<string, unknown>;
};

async function performRequest(
	url: string,
	options: {
		method?: RequestMethod;
		body?: string | Record<string, unknown>;
		headers?: Record<string, string>;
	},
): Promise<RequestResponse> {
	const response = await fetch(url, {
		method: options.method,
		headers: options.headers,
		body: typeof options.body === 'string' ? options.body : options.body ? JSON.stringify(options.body) : undefined,
	});

	const text = await response.text();
	let data: string | Record<string, unknown> = text;

	if (text) {
		try {
			data = JSON.parse(text) as Record<string, unknown>;
		} catch {
			data = text;
		}
	}

	return {
		status: response.status,
		statusText: response.statusText,
		headers: Object.fromEntries(response.headers.entries()),
		data,
	};
}

async function getAccessToken(credentials: ServiceAccountShape, scopes: string[]): Promise<string> {
	const issuedAt = Math.floor(Date.now() / 1000);
	const expiresAt = issuedAt + 3600;
	const header = bytesToBase64Url(new Uint8Array(stringToBytes(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))));
	const payload = bytesToBase64Url(
		new Uint8Array(
			stringToBytes(
				JSON.stringify({
					iss: credentials.client_email,
					scope: scopes.join(' '),
					aud: GOOGLE_OAUTH_TOKEN_URL,
					exp: expiresAt,
					iat: issuedAt,
				}),
			),
		),
	);
	const assertion = await signJwt(`${header}.${payload}`, credentials.private_key);
	const body = new URLSearchParams({
		grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
		assertion,
	}).toString();

	const response = await performRequest(GOOGLE_OAUTH_TOKEN_URL, {
		method: 'POST',
		body,
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
	});

	const data = ensureJsonObject(response.data, 'Google OAuth token response');
	const accessToken = data.access_token;

	if (typeof accessToken !== 'string') {
		throw new Error('Failed to retrieve Google OAuth access token.');
	}

	return accessToken;
}

function ensureJsonObject(value: string | Record<string, unknown>, label: string): Record<string, unknown> {
	if (typeof value === 'string') {
		const parsed = parseJson<Record<string, unknown>>(value, label);

		if (!parsed || Array.isArray(parsed)) {
			throw new Error(`${label} did not return a JSON object.`);
		}

		return parsed;
	}

	return value;
}

async function authorizedRequest(
	url: string,
	accessToken: string,
	options: {
		method?: RequestMethod;
		body?: string | Record<string, unknown>;
		headers?: Record<string, string>;
	},
): Promise<RequestResponse> {
	const response = await performRequest(url, {
		...options,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			...(typeof options.body === 'string' ? {} : { 'Content-Type': 'application/json' }),
			...options.headers,
		},
	});

	if (response.status >= 400) {
		const errorBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
		throw new Error(`Firebase request failed (${response.status} ${response.statusText}): ${errorBody}`);
	}

	return response;
}

function firestoreDocumentUrl(projectId: string, resource: string): string {
	return `${FIRESTORE_BASE_URL}/projects/${projectId}/databases/(default)/documents/${resource}`;
}

function firestoreDocumentsBaseUrl(projectId: string): string {
	return `${FIRESTORE_BASE_URL}/projects/${projectId}/databases/(default)/documents`;
}

function primitiveValueToFirestore(value: JsonValue): Record<string, unknown> {
	if (value === null) return { nullValue: null };
	if (typeof value === 'string') return { stringValue: value };
	if (typeof value === 'boolean') return { booleanValue: value };
	if (typeof value === 'number') {
		return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
	}

	if (Array.isArray(value)) {
		return {
			arrayValue: {
				values: value.map((item) => primitiveValueToFirestore(item)),
			},
		};
	}

	return {
		mapValue: {
			fields: objectToFirestoreFields(value),
		},
	};
}

function objectToFirestoreFields(value: JsonObject): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, primitiveValueToFirestore(item)]));
}

function firestoreValueToJson(value: Record<string, unknown>): JsonValue {
	if ('nullValue' in value) return null;
	if ('stringValue' in value && typeof value.stringValue === 'string') return value.stringValue;
	if ('booleanValue' in value && typeof value.booleanValue === 'boolean') return value.booleanValue;
	if ('integerValue' in value) return Number(value.integerValue);
	if ('doubleValue' in value && typeof value.doubleValue === 'number') return value.doubleValue;
	if ('timestampValue' in value && typeof value.timestampValue === 'string') return value.timestampValue;
	if ('arrayValue' in value && value.arrayValue && typeof value.arrayValue === 'object') {
		const values = (value.arrayValue as { values?: Array<Record<string, unknown>> }).values ?? [];
		return values.map((entry) => firestoreValueToJson(entry));
	}
	if ('mapValue' in value && value.mapValue && typeof value.mapValue === 'object') {
		const fields = (value.mapValue as { fields?: Record<string, Record<string, unknown>> }).fields ?? {};
		return Object.fromEntries(Object.entries(fields).map(([key, entry]) => [key, firestoreValueToJson(entry)]));
	}

	return value as JsonValue;
}

function firestoreDocumentToJson(document: Record<string, unknown>): Record<string, unknown> {
	const fields = (document.fields as Record<string, Record<string, unknown>> | undefined) ?? {};
	return {
		name: document.name,
		createTime: document.createTime,
		updateTime: document.updateTime,
		fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, firestoreValueToJson(value)])),
	};
}

async function executeFirestoreMethod(options: Options, credentials: ServiceAccountShape) {
	const accessToken = await getAccessToken(credentials, ['https://www.googleapis.com/auth/datastore']);
	const projectId = credentials.project_id;
	const payload = parseJson<JsonObject | Record<string, unknown>>(options.payload, 'Payload JSON');
	const resource = normalizeOptionalString(options.resource);
	const url = resource ? firestoreDocumentUrl(projectId, resource) : undefined;

	switch (options.method) {
		case 'get': {
			if (!url) throw new Error('Document path is required for Firestore get.');
			const response = await authorizedRequest(url, accessToken, { method: 'GET' });
			return firestoreDocumentToJson(ensureJsonObject(response.data, 'Firestore get response'));
		}
		case 'create': {
			if (!payload || Array.isArray(payload)) throw new Error('Payload JSON is required for Firestore create.');
			const parentPath = requireResource(resource, 'Collection path');
			const documentId = normalizeOptionalString(options.secondaryResource);
			const query = documentId ? `?documentId=${encodeURIComponent(documentId)}` : '';
			const response = await authorizedRequest(`${firestoreDocumentsBaseUrl(projectId)}/${parentPath}${query}`, accessToken, {
				method: 'POST',
				body: { fields: objectToFirestoreFields(payload as JsonObject) },
			});
			return firestoreDocumentToJson(ensureJsonObject(response.data, 'Firestore create response'));
		}
		case 'set': {
			if (!url) throw new Error('Document path is required for Firestore set.');
			const response = await authorizedRequest(url, accessToken, {
				method: 'PATCH',
				body: { fields: objectToFirestoreFields((payload as JsonObject | undefined) ?? {}) },
			});
			return firestoreDocumentToJson(ensureJsonObject(response.data, 'Firestore set response'));
		}
		case 'update': {
			if (!url) throw new Error('Document path is required for Firestore update.');
			if (!payload || Array.isArray(payload)) throw new Error('Payload JSON is required for Firestore update.');
			const updatePayload = payload as JsonObject;
			const query = Object.keys(updatePayload)
				.map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
				.join('&');
			const response = await authorizedRequest(`${url}?${query}`, accessToken, {
				method: 'PATCH',
				body: { fields: objectToFirestoreFields(updatePayload) },
			});
			return firestoreDocumentToJson(ensureJsonObject(response.data, 'Firestore update response'));
		}
		case 'batchGet': {
			const documents = Array.isArray(payload) ? payload : Array.isArray((payload as Record<string, unknown> | undefined)?.documents) ? ((payload as { documents: unknown[] }).documents as unknown[]) : [];
			if (documents.length === 0) throw new Error('Payload JSON must contain an array of document paths for Firestore batchGet.');
			const response = await authorizedRequest(`${firestoreDocumentsBaseUrl(projectId)}:batchGet`, accessToken, {
				method: 'POST',
				body: {
					documents: documents.map((document) => `${firestoreDocumentsBaseUrl(projectId)}/${String(document)}`),
				},
			});
			return response.data;
		}
		case 'commit': {
			if (!payload || Array.isArray(payload)) throw new Error('Payload JSON must contain a Firestore commit request body.');
			const response = await authorizedRequest(`${FIRESTORE_BASE_URL}/projects/${projectId}/databases/(default)/documents:commit`, accessToken, {
				method: 'POST',
				body: payload,
			});
			return response.data;
		}
		case 'runQuery': {
			if (!payload || Array.isArray(payload)) throw new Error('Payload JSON must contain a Firestore structuredQuery body.');
			const response = await authorizedRequest(`${FIRESTORE_BASE_URL}/projects/${projectId}/databases/(default)/documents:runQuery`, accessToken, {
				method: 'POST',
				body: payload,
			});
			return response.data;
		}
		case 'delete':
			if (!url) throw new Error('Document path is required for Firestore delete.');
			await authorizedRequest(url, accessToken, { method: 'DELETE' });
			return { success: true };
		case 'listCollections': {
			if (!url) throw new Error('Document path is required for Firestore listCollections.');
			const response = await authorizedRequest(`${url}:listCollectionIds`, accessToken, {
				method: 'POST',
				body: {},
			});
			return ensureJsonObject(response.data, 'Firestore listCollections response');
		}
		default:
			throw new Error(`Unsupported firestore method: ${options.method}`);
	}
}

async function executeMessagingMethod(options: Options, credentials: ServiceAccountShape) {
	const accessToken = await getAccessToken(credentials, ['https://www.googleapis.com/auth/firebase.messaging']);
	const payload = parseJson<Record<string, unknown>>(options.payload, 'Payload JSON');
	const validateOnly = options.secondaryResource === 'validateOnly';

	switch (options.method) {
		case 'send': {
			if (!payload) throw new Error('Payload JSON is required for Messaging send.');
			const message = typeof payload === 'object' && !Array.isArray(payload) && payload.message && typeof payload.message === 'object'
				? (payload.message as Record<string, unknown>)
				: payload;
			const response = await authorizedRequest(
				`${FCM_BASE_URL}/projects/${credentials.project_id}/messages:send`,
				accessToken,
				{
					method: 'POST',
					body: { message, validate_only: validateOnly },
				},
			);
			return ensureJsonObject(response.data, 'Messaging send response');
		}
		case 'sendValidate': {
			if (!payload) throw new Error('Payload JSON is required for Messaging sendValidate.');
			const message = typeof payload === 'object' && !Array.isArray(payload) && payload.message && typeof payload.message === 'object'
				? (payload.message as Record<string, unknown>)
				: payload;
			const response = await authorizedRequest(
				`${FCM_BASE_URL}/projects/${credentials.project_id}/messages:send`,
				accessToken,
				{
					method: 'POST',
					body: { message, validate_only: true },
				},
			);
			return ensureJsonObject(response.data, 'Messaging validate response');
		}
		case 'sendEach': {
			const messages = parseJson<Record<string, unknown>[]>(options.payload, 'Payload JSON');
			if (!messages || !Array.isArray(messages)) {
				throw new Error('Payload JSON must be an array of Firebase Messaging message objects.');
			}

			const responses = [] as Array<Record<string, unknown>>;

			for (const message of messages) {
				const response = await authorizedRequest(`${FCM_BASE_URL}/projects/${credentials.project_id}/messages:send`, accessToken, {
					method: 'POST',
					body: { message, validate_only: validateOnly },
				});

				responses.push(ensureJsonObject(response.data, 'Messaging sendEach item response'));
			}

			return { successCount: responses.length, responses };
		}
		default:
			throw new Error(`Unsupported messaging method in sandbox mode: ${options.method}`);
	}
}

async function executeRemoteConfigMethod(options: Options, credentials: ServiceAccountShape) {
	const accessToken = await getAccessToken(credentials, ['https://www.googleapis.com/auth/firebase.remoteconfig']);
	const url = `${REMOTE_CONFIG_BASE_URL}/projects/${credentials.project_id}/remoteConfig`;

	switch (options.method) {
		case 'getTemplate': {
			const response = await authorizedRequest(url, accessToken, {
				method: 'GET',
				headers: { 'Accept-Encoding': 'gzip' },
			});
			const body = ensureJsonObject(response.data, 'Remote Config getTemplate response');
			return {
				etag: response.headers.etag ?? response.headers.ETag ?? null,
				template: body,
			};
		}
		case 'publishTemplate': {
			const payload = parseJson<Record<string, unknown>>(options.payload, 'Payload JSON');
			if (!payload) throw new Error('Payload JSON is required for Remote Config publishTemplate.');

			const etag = typeof payload.etag === 'string' ? payload.etag : '*';
			const response = await authorizedRequest(url, accessToken, {
				method: 'PUT',
				body: payload,
				headers: {
					'If-Match': etag,
					'Accept-Encoding': 'gzip',
				},
			});

			return {
				etag: response.headers.etag ?? response.headers.ETag ?? null,
				template: ensureJsonObject(response.data, 'Remote Config publishTemplate response'),
			};
		}
		case 'validateTemplate': {
			const payload = parseJson<Record<string, unknown>>(options.payload, 'Payload JSON');
			if (!payload) throw new Error('Payload JSON is required for Remote Config validateTemplate.');

			const etag = typeof payload.etag === 'string' ? payload.etag : '*';
			const response = await authorizedRequest(`${url}?validate_only=true`, accessToken, {
				method: 'PUT',
				body: payload,
				headers: {
					'If-Match': etag,
					'Accept-Encoding': 'gzip',
				},
			});

			return {
				etag: response.headers.etag ?? response.headers.ETag ?? null,
				template: ensureJsonObject(response.data, 'Remote Config validateTemplate response'),
			};
		}
		case 'rollback': {
			const version = normalizeRequiredString(options.resource, 'Version number');
			const response = await authorizedRequest(`${REMOTE_CONFIG_BASE_URL}/projects/${credentials.project_id}/remoteConfig:rollback`, accessToken, {
				method: 'POST',
				body: { versionNumber: version },
				headers: { 'Accept-Encoding': 'gzip' },
			});

			return ensureJsonObject(response.data, 'Remote Config rollback response');
		}
		default:
			throw new Error(`Unsupported remoteConfig method: ${options.method}`);
	}
}

async function executeStorageMethod(options: Options, credentials: ServiceAccountShape) {
	const accessToken = await getAccessToken(credentials, ['https://www.googleapis.com/auth/devstorage.full_control']);
	const payload = parseJson<Record<string, unknown>>(options.payload, 'Payload JSON');
	const bucket = normalizeRequiredString(options.secondaryResource, 'Secondary Resource (bucket name)');
	const objectName = normalizeOptionalString(options.resource);
	const encodedObjectName = objectName ? encodeURIComponent(objectName) : undefined;
	const url = encodedObjectName ? `${STORAGE_BASE_URL}/b/${bucket}/o/${encodedObjectName}` : undefined;

	switch (options.method) {
		case 'list': {
			const prefix = objectName ? `?prefix=${encodeURIComponent(objectName)}` : '';
			const response = await authorizedRequest(`${STORAGE_BASE_URL}/b/${bucket}/o${prefix}`, accessToken, { method: 'GET' });
			return ensureJsonObject(response.data, 'Storage list response');
		}
		case 'getMetadata': {
			if (!url) throw new Error('File path is required for Storage getMetadata.');
			const response = await authorizedRequest(url, accessToken, { method: 'GET' });
			return ensureJsonObject(response.data, 'Storage getMetadata response');
		}
		case 'setMetadata': {
			if (!url) throw new Error('File path is required for Storage setMetadata.');
			const response = await authorizedRequest(url, accessToken, {
				method: 'PATCH',
				body: payload ?? {},
			});
			return ensureJsonObject(response.data, 'Storage setMetadata response');
		}
		case 'rewrite': {
			if (!url) throw new Error('Source file path is required for Storage rewrite.');
			const destination = requireResource(typeof payload?.destination === 'string' ? payload.destination : undefined, 'Payload JSON destination');
			const destinationBucket = typeof payload?.destinationBucket === 'string' ? payload.destinationBucket : bucket;
			const response = await authorizedRequest(
				`${url}/rewriteTo/b/${destinationBucket}/o/${encodeURIComponent(destination)}`,
				accessToken,
				{
					method: 'POST',
					body: {},
				},
			);
			return ensureJsonObject(response.data, 'Storage rewrite response');
		}
		case 'delete':
			if (!url) throw new Error('File path is required for Storage delete.');
			await authorizedRequest(url, accessToken, { method: 'DELETE' });
			return { success: true };
		default:
			throw new Error(`Unsupported storage method in sandbox mode: ${options.method}`);
	}
}

const operation = defineOperationApi<Options>({
	id: 'timio23-firebase-api',
	handler: async ({ service, method, auth, resource, secondaryResource, payload }) => {
		const options: Options = { service, method, auth, resource, secondaryResource, payload };
		const credentials = resolveCredentials(options.auth);

		switch (options.service) {
			case 'firestore':
				return executeFirestoreMethod(options, credentials);
			case 'messaging':
				return executeMessagingMethod(options, credentials);
			case 'remoteConfig':
				return executeRemoteConfigMethod(options, credentials);
			case 'storage':
				return executeStorageMethod(options, credentials);
			default:
				throw new Error(`Unsupported Firebase service: ${String(options.service)}`);
		}
	},
});

export default operation;
