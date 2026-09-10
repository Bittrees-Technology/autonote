import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  HeadObjectCommand,
  GetObjectCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
export const bucket = () => process.env.S3_BUCKET!;
export function storage() {
  if (
    !process.env.S3_BUCKET ||
    !process.env.S3_ACCESS_KEY_ID ||
    !process.env.S3_SECRET_ACCESS_KEY
  )
    throw new Error("Recording storage is not configured");
  return new S3Client({
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    region: process.env.S3_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
}
export async function beginUpload(key: string, type: string) {
  return (
    await storage().send(
      new CreateMultipartUploadCommand({
        Bucket: bucket(),
        Key: key,
        ContentType: type,
      }),
    )
  ).UploadId!;
}
export async function partUrl(
  key: string,
  uploadId: string,
  part: number,
  size: number,
) {
  return getSignedUrl(
    storage(),
    new UploadPartCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
      PartNumber: part,
      ContentLength: size,
    }),
    { expiresIn: 300, signableHeaders: new Set(["content-length"]) },
  );
}
export async function listParts(key: string, uploadId: string) {
  return (
    (
      await storage().send(
        new ListPartsCommand({
          Bucket: bucket(),
          Key: key,
          UploadId: uploadId,
        }),
      )
    ).Parts || []
  );
}
export async function finishUpload(
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[],
) {
  await storage().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }),
  );
}
export async function objectInfo(key: string) {
  return storage().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
}
export async function playbackUrl(key: string) {
  return getSignedUrl(
    storage(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: 120 },
  );
}
export async function abortUpload(key: string, uploadId: string) {
  await storage().send(
    new AbortMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
    }),
  );
}
export async function deleteObject(key: string) {
  await storage().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
