import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
} from "@aws-sdk/client-s3";
import { storage, bucket } from "../lib/storage";
const s = storage();
try {
  await s.send(new HeadBucketCommand({ Bucket: bucket() }));
} catch {
  await s.send(new CreateBucketCommand({ Bucket: bucket() }));
}
try {
  await s.send(
    new PutBucketCorsCommand({
      Bucket: bucket(),
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [process.env.APP_URL!],
            AllowedMethods: ["PUT", "GET", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 300,
          },
        ],
      },
    }),
  );
} catch (e) {
  if (process.env.S3_ENDPOINT !== "http://127.0.0.1:9050") throw e;
  console.log("Local MinIO uses its server CORS policy.");
}
try {
  await s.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket(),
      LifecycleConfiguration: {
        Rules: [
          {
            ID: "abort-incomplete",
            Status: "Enabled",
            Filter: { Prefix: "" },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          },
        ],
      },
    }),
  );
} catch (e) {
  if (process.env.S3_ENDPOINT !== "http://127.0.0.1:9050") throw e;
  console.log("Local cleanup is managed by the worker.");
}
console.log("Private recording bucket configured.");
