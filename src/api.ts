import type { SandboxOperationConfig, SandboxRequestResponse } from 'directus:api';
import { log, request } from 'directus:api';
import forge from 'node-forge';

type Options = {
	service: FirebaseService;
	method: string;
	auth?: string;
	resource?: string;
	secondaryResource?: string;
	payload?: string;
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

function parseJson<T>(value: string | undefined, fieldName: string): T | undefined {
	if (!value || value.trim() === '') return undefined;

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

function resolveCredentials(auth: string | undefined): ServiceAccountShape {
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

function utf8Encode(value: string): Uint8Array {
	const bytes: number[] = [];

	for (let index = 0; index < value.length; index += 1) {
		let codePoint = value.charCodeAt(index);

		if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
			const nextCodePoint = value.charCodeAt(index + 1);

			if (nextCodePoint >= 0xdc00 && nextCodePoint <= 0xdfff) {
				codePoint = ((codePoint - 0xd800) << 10) + (nextCodePoint - 0xdc00) + 0x10000;
				index += 1;
			}
		}

		if (codePoint <= 0x7f) {
			bytes.push(codePoint);
		} else if (codePoint <= 0x7ff) {
			bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
		} else if (codePoint <= 0xffff) {
			bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
		} else {
			bytes.push(
				0xf0 | (codePoint >> 18),
				0x80 | ((codePoint >> 12) & 0x3f),
				0x80 | ((codePoint >> 6) & 0x3f),
				0x80 | (codePoint & 0x3f),
			);
		}
	}

	return Uint8Array.from(bytes);
}

function stringToBytes(value: string): number[] {
	return Array.from(utf8Encode(value));
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Encode(bytes: Uint8Array): string {
	let output = '';

	for (let index = 0; index < bytes.length; index += 3) {
		const byte1 = bytes[index]!;
		const byte2 = bytes[index + 1];
		const byte3 = bytes[index + 2];
		const chunk = (byte1 << 16) | ((byte2 ?? 0) << 8) | (byte3 ?? 0);

		output += BASE64_ALPHABET[(chunk >> 18) & 0x3f];
		output += BASE64_ALPHABET[(chunk >> 12) & 0x3f];
		output += typeof byte2 === 'number' ? BASE64_ALPHABET[(chunk >> 6) & 0x3f] : '=';
		output += typeof byte3 === 'number' ? BASE64_ALPHABET[chunk & 0x3f] : '=';
	}

	return output;
}

function toFormUrlEncoded(values: Record<string, string>): string {
	return Object.entries(values)
		.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
		.join('&');
}

function bytesToBase64Url(bytes: Uint8Array): string {
	return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function signJwt(unsignedToken: string, privateKeyPem: string): string {
	let privateKey: forge.pki.rsa.PrivateKey;

	try {
		privateKey = forge.pki.privateKeyFromPem(privateKeyPem) as forge.pki.rsa.PrivateKey;
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown private key parsing error';
		throw new Error(`Failed to parse Firebase service account private key. ${message}`);
	}

	const md = forge.md.sha256.create();
	md.update(unsignedToken, 'utf8');
	const signature = privateKey.sign(md);
	const signatureBytes = Uint8Array.from(Array.from(signature as string, (char) => char.charCodeAt(0)));

	return `${unsignedToken}.${bytesToBase64Url(signatureBytes)}`;
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
	const assertion = signJwt(`${header}.${payload}`, credentials.private_key);
	const body = toFormUrlEncoded({
		grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
		assertion,
	});

	const response = await request(GOOGLE_OAUTH_TOKEN_URL, {
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
		method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
		body?: string | Record<string, unknown>;
		headers?: Record<string, string>;
	},
): Promise<SandboxRequestResponse> {
	const response = await request(url, {
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
	const resource = options.resource?.trim();
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
			const documentId = typeof options.secondaryResource === 'string' && options.secondaryResource.trim() !== '' ? options.secondaryResource.trim() : undefined;
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
			const response = await authorizedRequest(
				`${FCM_BASE_URL}/projects/${credentials.project_id}/messages:send`,
				accessToken,
				{
					method: 'POST',
					body: { message: payload, validate_only: validateOnly },
				},
			);
			return ensureJsonObject(response.data, 'Messaging send response');
		}
		case 'sendValidate': {
			if (!payload) throw new Error('Payload JSON is required for Messaging sendValidate.');
			const response = await authorizedRequest(
				`${FCM_BASE_URL}/projects/${credentials.project_id}/messages:send`,
				accessToken,
				{
					method: 'POST',
					body: { message: payload, validate_only: true },
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
			const version = requireResource(options.resource, 'Version number');
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
	const bucket = requireResource(options.secondaryResource, 'Secondary Resource (bucket name)');
	const objectName = options.resource?.trim();
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

const operation: SandboxOperationConfig = {
	id: 'timio23-firebase-api',
	handler: async (rawOptions: Record<string, unknown>) => {
		const options = rawOptions as Options;
		const credentials = resolveCredentials(options.auth);
		log(`Executing Firebase sandbox operation: ${options.service}.${options.method}`);

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
				throw new Error(`Unsupported Firebase service in sandbox mode: ${String(options.service)}`);
		}
	},
};

export default operation;
