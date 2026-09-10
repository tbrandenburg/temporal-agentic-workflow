import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { artifactRefToObjectKey, formatArtifactRef } from './ref';

export interface ArtifactStoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO requires path-style addressing; defaults to true. */
  forcePathStyle?: boolean;
}

/** Reads the S3-compatible artifact store config from env, suitable for the
 * Phase 1 MinIO compose service (`localhost:9000`). */
export function loadArtifactStoreConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ArtifactStoreConfig {
  return {
    endpoint: env.ARTIFACT_STORE_ENDPOINT ?? 'http://localhost:9000',
    region: env.ARTIFACT_STORE_REGION ?? 'us-east-1',
    bucket: env.ARTIFACT_STORE_BUCKET ?? 'agent-artifacts',
    accessKeyId: env.ARTIFACT_STORE_ACCESS_KEY_ID ?? 'minioadmin',
    secretAccessKey: env.ARTIFACT_STORE_SECRET_ACCESS_KEY ?? 'minioadmin',
    forcePathStyle: true,
  };
}

/**
 * Thin wrapper over an S3-compatible client (MinIO in this PoC).
 * `client` is injectable so unit tests never require MinIO to be running —
 * see PLAN §2 artifact-store deliverable.
 */
export class ArtifactStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ArtifactStoreConfig, client?: S3Client) {
    this.bucket = config.bucket;
    this.client =
      client ??
      new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle ?? true,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
  }

  /** Writes `body` to the deterministic key for `runs/<run_id>/<role>/<name>`. */
  async put(runId: string, role: string, name: string, body: Buffer | string): Promise<string> {
    const ref = formatArtifactRef({ runId, role, name });
    const key = artifactRefToObjectKey(ref);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body }));
    return ref;
  }

  /** Reads the raw body for an `artifact://` ref. */
  async get(ref: string): Promise<string> {
    const key = artifactRefToObjectKey(ref);
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = await result.Body?.transformToString();
    return body ?? '';
  }

  /** Presigns a time-limited GET URL for an `artifact://` ref. */
  async presign(ref: string, expiresInSeconds = 3600): Promise<string> {
    const key = artifactRefToObjectKey(ref);
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
