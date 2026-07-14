import { defineOperationApp } from '@directus/extensions-sdk';

const serviceChoices = [
	{ text: 'Firestore', value: 'firestore' },
	{ text: 'Messaging', value: 'messaging' },
	{ text: 'Storage', value: 'storage' },
	{ text: 'Remote Config', value: 'remoteConfig' },
];

const methodChoices = {
	firestore: [
		{ text: 'Get Document', value: 'get' },
		{ text: 'Create Document', value: 'create' },
		{ text: 'Set Document', value: 'set' },
		{ text: 'Update Document', value: 'update' },
		{ text: 'Batch Get Documents', value: 'batchGet' },
		{ text: 'Commit', value: 'commit' },
		{ text: 'Run Query', value: 'runQuery' },
		{ text: 'Delete Document', value: 'delete' },
		{ text: 'List Collections', value: 'listCollections' },
	],
	messaging: [
		{ text: 'Send', value: 'send' },
		{ text: 'Validate Send', value: 'sendValidate' },
		{ text: 'Send Each', value: 'sendEach' },
	],
	storage: [
		{ text: 'List Files', value: 'list' },
		{ text: 'Get Metadata', value: 'getMetadata' },
		{ text: 'Set Metadata', value: 'setMetadata' },
		{ text: 'Rewrite File', value: 'rewrite' },
		{ text: 'Delete File', value: 'delete' },
	],
	remoteConfig: [
		{ text: 'Get Template', value: 'getTemplate' },
		{ text: 'Validate Template', value: 'validateTemplate' },
		{ text: 'Publish Template', value: 'publishTemplate' },
		{ text: 'Rollback', value: 'rollback' },
	],
} as const;

const authFieldNote =
	'Optional JSON service account credentials. Leave empty to use FIREBASE_SDK_AUTH_* environment variables.';

const resourceConfig = {
	get: {
		note: 'Firestore document path, for example users/123.',
		placeholder: 'users/123',
	},
	create: {
		note: 'Firestore collection path, for example users.',
		placeholder: 'users',
	},
	set: {
		note: 'Firestore document path to fully replace or create.',
		placeholder: 'users/123',
	},
	update: {
		note: 'Firestore document path to patch.',
		placeholder: 'users/123',
	},
	batchGet: {
		note: 'Not used. Supply document paths in Payload JSON.',
		placeholder: 'Leave empty',
	},
	commit: {
		note: 'Not used. Supply Firestore commit operations in Payload JSON.',
		placeholder: 'Leave empty',
	},
	runQuery: {
		note: 'Not used. Supply structuredQuery JSON in Payload JSON.',
		placeholder: 'Leave empty',
	},
	delete: {
		note: 'Firestore document path to delete, or storage file path when Service is Storage.',
		placeholder: 'users/123',
	},
	listCollections: {
		note: 'Firestore document path whose child collections should be listed.',
		placeholder: 'users/123',
	},
	send: {
		note: 'Not used. Supply the FCM message in Payload JSON.',
		placeholder: 'Leave empty',
	},
	sendValidate: {
		note: 'Not used. Supply the FCM message in Payload JSON.',
		placeholder: 'Leave empty',
	},
	sendEach: {
		note: 'Not used. Supply an array of FCM messages in Payload JSON.',
		placeholder: 'Leave empty',
	},
	list: {
		note: 'Optional storage prefix for filtering listed files.',
		placeholder: 'images/',
	},
	getMetadata: {
		note: 'Storage file path.',
		placeholder: 'uploads/report.pdf',
	},
	setMetadata: {
		note: 'Storage file path whose metadata should be updated.',
		placeholder: 'uploads/report.pdf',
	},
	rewrite: {
		note: 'Source storage file path to rewrite to a new destination.',
		placeholder: 'uploads/report.pdf',
	},
	getTemplate: {
		note: 'Not used for getTemplate.',
		placeholder: 'Leave empty',
	},
	validateTemplate: {
		note: 'Not used. Supply the Remote Config template in Payload JSON.',
		placeholder: 'Leave empty',
	},
	publishTemplate: {
		note: 'Not used. Supply the Remote Config template in Payload JSON.',
		placeholder: 'Leave empty',
	},
	rollback: {
		note: 'Remote Config version number to roll back to.',
		placeholder: '42',
	},
} as const;

const secondaryResourceConfig = {
	create: {
		note: 'Optional Firestore document ID. Leave empty to let Firestore generate one.',
		placeholder: 'user_123',
	},
	send: {
		note: 'Optional. Set to validateOnly to validate without sending.',
		placeholder: 'validateOnly',
	},
	sendValidate: {
		note: 'Optional. Leave empty; validation is always enabled for this method.',
		placeholder: 'Leave empty',
	},
	sendEach: {
		note: 'Optional. Set to validateOnly to validate all messages without sending.',
		placeholder: 'validateOnly',
	},
	list: {
		note: 'Storage bucket name.',
		placeholder: 'my-project.appspot.com',
	},
	getMetadata: {
		note: 'Storage bucket name.',
		placeholder: 'my-project.appspot.com',
	},
	setMetadata: {
		note: 'Storage bucket name.',
		placeholder: 'my-project.appspot.com',
	},
	rewrite: {
		note: 'Source storage bucket name.',
		placeholder: 'my-project.appspot.com',
	},
	delete: {
		note: 'Storage bucket name when Service is Storage. Otherwise leave empty.',
		placeholder: 'my-project.appspot.com',
	},
} as const;

const payloadConfig = {
	firestore_create: '{\n  "name": "Tim"\n}',
	firestore_set: '{\n  "name": "Tim"\n}',
	firestore_update: '{\n  "name": "Updated Tim"\n}',
	firestore_batchGet: '[\n  "users/123",\n  "users/456"\n]',
	firestore_commit: '{\n  "writes": [\n    {\n      "update": {\n        "name": "projects/my-project/databases/(default)/documents/users/123",\n        "fields": {\n          "name": { "stringValue": "Tim" }\n        }\n      }\n    }\n  ]\n}',
	firestore_runQuery: '{\n  "structuredQuery": {\n    "from": [{ "collectionId": "users" }],\n    "limit": 10\n  }\n}',
	messaging_send: '{\n  "token": "device-token",\n  "notification": {\n    "title": "Hello",\n    "body": "World"\n  },\n  "data": {\n    "type": "example"\n  }\n}',
	messaging_sendValidate: '{\n  "token": "device-token",\n  "notification": {\n    "title": "Hello",\n    "body": "World"\n  },\n  "data": {\n    "type": "example"\n  }\n}',
	messaging_sendEach: '[\n  {\n    "token": "token-1",\n    "notification": { "title": "Hello", "body": "One" }\n  },\n  {\n    "token": "token-2",\n    "notification": { "title": "Hello", "body": "Two" }\n  }\n]',
	storage_setMetadata: '{\n  "metadata": {\n    "cacheControl": "public, max-age=3600"\n  }\n}',
	storage_rewrite: '{\n  "destination": "archive/report.pdf",\n  "destinationBucket": "my-project.appspot.com"\n}',
	remoteConfig_validateTemplate: '{\n  "parameters": {},\n  "conditions": []\n}',
	remoteConfig_publishTemplate: '{\n  "parameters": {},\n  "conditions": [],\n  "etag": "*"\n}',
} as const;

const methodsWithoutResource = ['batchGet', 'commit', 'runQuery', 'send', 'sendValidate', 'sendEach', 'getTemplate', 'validateTemplate', 'publishTemplate'] as const;
const methodsWithSecondaryResource = ['create', 'send', 'sendValidate', 'sendEach', 'list', 'getMetadata', 'setMetadata', 'rewrite', 'delete'] as const;
const methodsWithoutPayload = ['get', 'delete', 'listCollections', 'getTemplate', 'rollback', 'getMetadata', 'list'] as const;

function getPayloadPlaceholder(payloadKey: string | null) {
	if (!payloadKey) {
		return '{\n  "key": "value"\n}';
	}

	return payloadConfig[payloadKey as keyof typeof payloadConfig] ?? '{\n  "key": "value"\n}';
}

function getPayloadTemplate(payloadKey: string | null) {
	const placeholder = getPayloadPlaceholder(payloadKey);

	try {
		return JSON.parse(placeholder);
	} catch {
		return { key: 'value' };
	}
}

function createDisabledConditions(methods: readonly string[]) {
	return [
		{
			name: 'Disable field when method does not apply',
			rule: {
				method: {
					_in: [...methods],
				},
			},
			readonly: true,
			clear_hidden_value_on_save: true,
		},
		{
			name: 'Enable field for other methods',
			rule: {
				method: {
					_nin: [...methods],
				},
			},
			readonly: false,
		},
	];
}

function createSecondaryResourceConditions() {
	return [
		{
			name: 'Enable Secondary Resource for matching methods',
			rule: {
				method: {
					_in: [...methodsWithSecondaryResource],
				},
			},
			readonly: false,
		},
		{
			name: 'Disable Secondary Resource for other methods',
			rule: {
				method: {
					_nin: [...methodsWithSecondaryResource],
				},
			},
			readonly: true,
			clear_hidden_value_on_save: true,
		},
	];
}

export default defineOperationApp({
	id: 'timio23-firebase-api',
	name: 'Firebase API',
	icon: 'box',
	description: 'Call selected Firebase Admin SDK services with optional JSON input.',
	overview: ({ service, method }) => [
		{
			label: 'Service',
			text: service || 'Not set',
		},
		{
			label: 'Method',
			text: method || 'Not set',
		},
	],
	options: ({ service, method }) => {
		const payloadKey = service && method ? `${service}_${method}` : null;
		const payloadPlaceholder = getPayloadPlaceholder(payloadKey);

		return [
		{
			field: 'service',
			name: 'Service',
			type: 'string' as const,
			meta: {
				width: 'half' as const,
				interface: 'select-dropdown' as const,
				required: true,
				options: {
					choices: serviceChoices,
				},
			},
		},
		{
			field: 'method',
			name: 'Method',
			type: 'string' as const,
			meta: {
				width: 'half' as const,
				interface: 'select-dropdown' as const,
				required: true,
				options: {
					choices: service ? methodChoices[service as keyof typeof methodChoices] ?? [] : [],
				},
			},
		},
		{
			field: 'resource',
			name: 'Resource',
			type: 'string' as const,
			meta: {
				width: 'half' as const,
				interface: 'input' as const,
				note: method ? resourceConfig[method as keyof typeof resourceConfig]?.note ?? 'Value depends on the selected method.' : 'Value depends on the selected method.',
				conditions: createDisabledConditions(methodsWithoutResource),
				options: {
					placeholder: method ? resourceConfig[method as keyof typeof resourceConfig]?.placeholder ?? 'Enter a value' : 'Enter a value',
				},
			},
		},
		{
			field: 'secondaryResource',
			name: 'Secondary Resource',
			type: 'string' as const,
			meta: {
				width: 'half' as const,
				interface: 'input' as const,
				note: method ? secondaryResourceConfig[method as keyof typeof secondaryResourceConfig]?.note ?? 'Optional second value for methods that need it.' : 'Optional second value for methods that need it.',
				conditions: createSecondaryResourceConditions(),
				options: {
					placeholder: method ? secondaryResourceConfig[method as keyof typeof secondaryResourceConfig]?.placeholder ?? 'Optional' : 'Optional',
				},
			},
		},
		{
			field: 'payload',
			name: 'Payload JSON',
			type: 'string' as const,
			meta: {
				width: 'full' as const,
				interface: 'input-code' as const,
				note: 'Optional JSON payload passed to the selected Firebase REST call. Click the template button to insert an example query.',
				conditions: createDisabledConditions(methodsWithoutPayload),
				options: {
					language: 'json',
					placeholder: payloadPlaceholder,
					template: getPayloadTemplate(payloadKey),
				},
			},
		},
		{
			field: 'auth',
			name: 'Auth JSON',
			type: 'string' as const,
			meta: {
				width: 'full' as const,
				interface: 'input-code' as const,
				note: `${authFieldNote} Sandbox mode uses service-account based Google OAuth requests.`,
				options: {
					language: 'json',
					placeholder:
						'{\n  "type": "service_account",\n  "project_id": "my-project",\n  "private_key_id": "abc123",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n",\n  "client_email": "firebase-adminsdk@my-project.iam.gserviceaccount.com",\n  "client_id": "1234567890",\n  "auth_uri": "https://accounts.google.com/o/oauth2/auth",\n  "token_uri": "https://oauth2.googleapis.com/token",\n  "provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",\n  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/...",\n  "universe_domain": "googleapis.com"\n}',
				},
			},
		},
		];
	},
});
