import { s3Storage } from "@hot-updater/aws";
import type { CreateHotUpdaterOptions } from "@hot-updater/server";
import type { S3Config } from "./config.ts";

/** What the OTA server passes to hot-updater as per-request context. */
export interface OtaContext {
  /** The device's request; its Host header seeds `S3_PUBLIC_ENDPOINT=auto`. */
  readonly request?: Request;
}

export type OtaStorage = NonNullable<CreateHotUpdaterOptions<OtaContext>["storages"]>[number];

const MAX_SIGNERS = 16;

/**
 * Resolves the origin devices download bundles from.
 *
 * A fixed `publicEndpoint` wins. With `"auto"`, the device's own view of this
 * server is reused: a phone that reached `http://192.168.1.20:3002` gets
 * download URLs on `http://192.168.1.20:<S3 port>`, a simulator that reached
 * `localhost` gets `localhost`. Scheme and port come from the internal
 * endpoint, so MinIO must publish the same port on the host.
 */
export function resolvePublicEndpoint(s3: S3Config, request: Request | undefined): string {
  if (s3.publicEndpoint !== "auto") return s3.publicEndpoint;
  const host = request?.headers.get("host");
  if (!host) return s3.endpoint;
  const internal = new URL(s3.endpoint);
  let derived: URL;
  try {
    derived = new URL(`${internal.protocol}//${host}`);
  } catch {
    return s3.endpoint;
  }
  derived.port = internal.port;
  return derived.origin;
}

/**
 * `s3Storage` with split endpoints: server-side reads go to the internal
 * endpoint, while download URLs are presigned for the public one. SigV4 signs
 * the Host header, so rewriting a presigned URL afterwards would break it —
 * the URL has to be signed for the host the phone will actually call.
 * Presigning is offline; no request reaches the public endpoint from here.
 */
export function createS3Storage(s3: S3Config): OtaStorage {
  const forEndpoint = (endpoint: string) =>
    s3Storage({
      endpoint,
      region: s3.region,
      forcePathStyle: true,
      bucketName: s3.bucket,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    })();

  const internal = forEndpoint(s3.endpoint);
  const signers = new Map<string, ReturnType<typeof forEndpoint>>([[s3.endpoint, internal]]);
  const signerFor = (endpoint: string) => {
    let signer = signers.get(endpoint);
    if (!signer) {
      if (signers.size >= MAX_SIGNERS) {
        const oldest = [...signers.keys()].find((key) => key !== s3.endpoint);
        if (oldest) signers.delete(oldest);
      }
      signer = forEndpoint(endpoint);
      signers.set(endpoint, signer);
    }
    return signer;
  };

  return {
    ...internal,
    name: "s3StorageWithPublicEndpoint",
    profiles: {
      ...internal.profiles,
      runtime: {
        readText: (storageUri) => internal.profiles.runtime.readText(storageUri),
        getDownloadUrl: (storageUri, context?: OtaContext) =>
          signerFor(resolvePublicEndpoint(s3, context?.request)).profiles.runtime.getDownloadUrl(
            storageUri,
          ),
      },
    },
  };
}
