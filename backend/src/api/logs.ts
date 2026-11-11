import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";

export interface LogReader {
  get(deploymentId: string): Promise<string | undefined>;
}

export const logKey = (deploymentId: string) => `logs/${deploymentId}.txt`;

export class S3LogReader implements LogReader {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async get(deploymentId: string): Promise<string | undefined> {
    try {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: logKey(deploymentId) }));
      return await out.Body?.transformToString("utf-8");
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return undefined;
      throw err;
    }
  }
}
