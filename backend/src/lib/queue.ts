import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";

export interface QueueMessage {
  receiptHandle: string;
  body: string;
  receiveCount: number;
}

export interface BuildQueueSender {
  send(body: string): Promise<void>;
}

export class BuildQueue implements BuildQueueSender {
  private url: string | undefined;
  private readonly name: string | undefined;

  constructor(
    private readonly sqs: SQSClient,
    opts: { url?: string; name?: string },
  ) {
    if (!opts.url && !opts.name) throw new Error("BUILD_QUEUE_URL or BUILD_QUEUE_NAME is required");
    this.url = opts.url;
    this.name = opts.name;
  }

  private async queueUrl(): Promise<string> {
    if (!this.url) {
      const out = await this.sqs.send(new GetQueueUrlCommand({ QueueName: this.name! }));
      if (!out.QueueUrl) throw new Error(`queue ${this.name} not found`);
      this.url = out.QueueUrl;
    }
    return this.url;
  }

  async send(body: string): Promise<void> {
    await this.sqs.send(new SendMessageCommand({ QueueUrl: await this.queueUrl(), MessageBody: body }));
  }

  /** Long-polls for one message. The message is hidden from other consumers for `visibilitySeconds`. */
  async receive(waitSeconds: number, visibilitySeconds: number): Promise<QueueMessage | undefined> {
    const out = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: await this.queueUrl(),
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: waitSeconds,
        VisibilityTimeout: visibilitySeconds,
        MessageSystemAttributeNames: ["ApproximateReceiveCount"],
      }),
    );
    const m = out.Messages?.[0];
    if (!m || !m.ReceiptHandle || m.Body === undefined) return undefined;
    return {
      receiptHandle: m.ReceiptHandle,
      body: m.Body,
      receiveCount: Number(m.Attributes?.ApproximateReceiveCount ?? 1),
    };
  }

  async delete(receiptHandle: string): Promise<void> {
    await this.sqs.send(new DeleteMessageCommand({ QueueUrl: await this.queueUrl(), ReceiptHandle: receiptHandle }));
  }
}
