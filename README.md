# Directus Firebase API Operation

A Directus operation extension that exposes Firebase APIs inside Directus Flows.

## Supported services

- `firestore`
- `messaging`
- `storage`
- `remoteConfig`

## What this extension does

This operation lets you:

1. choose a Firebase service
2. choose a method for that service
3. provide Firebase service account credentials or environment variables
4. optionally provide a resource identifier
5. optionally provide a JSON payload
6. return the Firebase API response back to the flow

The operation is intentionally generic so it stays simple and future-proof.

## Installation

Install dependencies and build the extension:

- `npm install @timio23/directus-firebase-operation`

Then link or load it into Directus using your normal extension workflow.

## Credentials

The operation supports two credential sources:

### 1. Environment variables

If your Directus instance already has Firebase credentials in environment variables, you can leave the `Auth JSON` field empty.

Supported environment variables:

- `FIREBASE_SDK_AUTH_TYPE`
- `FIREBASE_SDK_AUTH_PROJECT_ID`
- `FIREBASE_SDK_AUTH_PRIVATE_KEY_ID`
- `FIREBASE_SDK_AUTH_PRIVATE_KEY`
- `FIREBASE_SDK_AUTH_CLIENT_EMAIL`
- `FIREBASE_SDK_AUTH_CLIENT_ID`
- `FIREBASE_SDK_AUTH_AUTH_URI`
- `FIREBASE_SDK_AUTH_TOKEN_URI`
- `FIREBASE_SDK_AUTH_PROVIDER_X509_CERT_URL`
- `FIREBASE_SDK_AUTH_CLIENT_X509_CERT_URL`
- `FIREBASE_SDK_AUTH_UNIVERSAL_DOMAIN`

### 2. `Auth JSON` field

If env vars are not present, paste the Firebase service account JSON into `Auth JSON`.

Example:

```json
{
  "type": "service_account",
  "project_id": "my-project",
  "private_key_id": "abc123",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk@my-project.iam.gserviceaccount.com",
  "client_id": "1234567890",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/...",
  "universe_domain": "googleapis.com"
}
```

If both env vars and `Auth JSON` are supplied, the JSON values override env values.

These credentials are used to mint short-lived Google OAuth access tokens for Firebase and Google APIs.

## Operation fields

### `Service`
A dropdown for the Firebase service.

Allowed values:

- `firestore`
- `messaging`
- `storage`
- `remoteConfig`

### `Method`
A dropdown that changes based on the selected service.

### `Auth JSON`
Optional JSON string containing Firebase service account credentials.

### `Resource`
A generic string input used for the primary identifier required by the selected method.

Examples:

- Firestore document path
- Storage file path

### `Secondary Resource`
Optional second identifier.

Currently used by storage methods as the bucket name.

Example:

- `my-project.appspot.com`

### `Payload JSON`
Optional JSON string passed to the selected Firebase Admin SDK method.

## Supported methods

### Firestore

#### `get`
Get a Firestore document.

**Inputs**
- `Resource`: document path, for example `users/123`
- `Payload JSON`: not used

**Response**

Returns the Firestore REST document mapped into a simpler JSON object with `name`, timestamps, and converted field values.

#### `create`
Create a Firestore document in a collection.

**Inputs**
- `Resource`: collection path, for example `users`
- `Secondary Resource`: optional document ID
- `Payload JSON`: object to write

**Response**
- created document object

#### `set`
Set a Firestore document.

**Inputs**
- `Resource`: document path
- `Payload JSON`: object to write

**Response**
- updated document object

#### `update`
Update a Firestore document.

**Inputs**
- `Resource`: document path
- `Payload JSON`: object to update

**Response**
- updated document object

#### `batchGet`
Fetch multiple Firestore documents.

**Inputs**
- `Payload JSON`: array of document paths or `{ "documents": [...] }`

**Example payload**

```json
[
  "users/123",
  "users/456"
]
```

**Response**
- raw Firestore batch get response

#### `commit`
Execute a Firestore commit request.

**Inputs**
- `Payload JSON`: Firestore commit request body

**Response**
- raw Firestore commit response

#### `runQuery`
Run a Firestore structured query.

**Inputs**
- `Payload JSON`: Firestore structured query request body

**Response**
- raw Firestore runQuery response

#### `delete`
Delete a Firestore document.

**Inputs**
- `Resource`: document path
- `Payload JSON`: not used

**Response**

```json
{
  "success": true
}
```

#### `listCollections`
List subcollections for a document.

**Inputs**
- `Resource`: document path
- `Payload JSON`: not used

**Response**
- Firestore `listCollectionIds` response object

---

### Messaging

#### `send`
Send a single Firebase Cloud Messaging HTTP v1 message.

**Inputs**
- `Resource`: not used
- `Payload JSON`: Firebase `Message`

**Example payload**

```json
{
  "token": "device-token",
  "notification": {
    "title": "Hello",
    "body": "World"
  },
  "data": {
    "type": "example"
  }
}
```

**Response**
- Firebase HTTP v1 send response object, typically containing `name`

Tip: set `Secondary Resource` to `validateOnly` to validate without sending.

#### `sendValidate`
Validate a single Firebase Cloud Messaging message without sending it.

**Inputs**
- `Payload JSON`: Firebase `Message`

**Response**
- Firebase validation response object

#### `sendEach`
Send multiple Firebase Cloud Messaging messages one by one.

**Inputs**
- `Resource`: not used
- `Payload JSON`: array of Firebase `Message` objects

**Response**
- object containing `successCount` and `responses`

Tip: set `Secondary Resource` to `validateOnly` to validate each message without sending.

---

### Storage

#### `list`
List files in a bucket.

**Inputs**
- `Secondary Resource`: bucket name
- `Resource`: optional prefix

**Response**
- storage objects list response

#### `getMetadata`
Get metadata for a file.

**Inputs**
- `Resource`: file path
- `Secondary Resource`: bucket name
- `Payload JSON`: not used

**Response**
- file metadata object

#### `setMetadata`
Set metadata for a file.

**Inputs**
- `Resource`: file path
- `Secondary Resource`: bucket name
- `Payload JSON`: metadata object

**Response**
- updated file metadata object

#### `rewrite`
Copy or move an object by rewriting it to a new destination.

**Inputs**
- `Resource`: source file path
- `Secondary Resource`: source bucket name
- `Payload JSON`: `{ "destination": "new/path/file.ext", "destinationBucket": "optional-bucket" }`

**Response**
- storage rewrite response

#### `delete`
Delete a file.

**Inputs**
- `Resource`: file path
- `Secondary Resource`: bucket name
- `Payload JSON`: not used

**Response**

```json
{
  "success": true
}
```

---

### Remote Config

#### `getTemplate`
Get the current Remote Config template.

**Inputs**
- `Payload JSON`: not used

**Response**
- object containing `etag` and `template`

#### `validateTemplate`
Validate a Remote Config template without publishing it.

**Inputs**
- `Payload JSON`: Remote Config template object

**Response**
- object containing `etag` and validated `template`

#### `publishTemplate`
Publish a Remote Config template.

**Inputs**
- `Payload JSON`: Remote Config template object

**Response**
- object containing `etag` and published `template`

#### `rollback`
Rollback Remote Config to a specific version.

**Inputs**
- `Resource`: version number

**Response**
- Remote Config rollback response

## Error behavior

The operation throws errors when:

- JSON fields are invalid
- required credentials are incomplete
- a required `Resource` value is missing
- the chosen method does not match the selected service
- a payload shape is invalid for certain methods
- a sandbox-incompatible method is requested

Examples:

- `Auth JSON must contain valid JSON`
- `Payload JSON must contain valid JSON`
- `Missing Firebase credentials: ...`
- `UID is required for this Firebase call.`

## Notes and limitations

- This extension no longer uses `firebase-admin`.
- It is designed for Directus sandbox mode and uses outbound HTTP requests only.
- The dropdowns are static, not dynamically generated from Firebase APIs.
- The operation only supports the methods currently wired in `src/api.ts`.
- Some responses are raw Google API responses.
- `auth` was removed because the old Admin SDK behavior is not equivalent in simple sandbox-safe REST form.
- Storage signed URL generation is not included in sandbox mode.
- Messaging topic subscription methods are not included in sandbox mode.
- Some Firestore methods return raw Google API response shapes.
- `Secondary Resource` is overloaded for some methods to keep the form simple.

