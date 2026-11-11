import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";



interface RegionConfig {
  AWS_REGION: string;
}

export function createS3(cfg: RegionConfig & { S3_FORCE_PATH_STYLE: boolean }): S3Client {
  return new S3Client({
    region: cfg.AWS_REGION,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export function createSqs(cfg: RegionConfig): SQSClient {
  return new SQSClient({ region: cfg.AWS_REGION });
}

export function createDynamo(cfg: RegionConfig): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region: cfg.AWS_REGION }), {
    marshallOptions: { removeUndefinedValues: true },
  });
}
