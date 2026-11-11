import { GetCommand, PutCommand, QueryCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ACTIVE_STATUSES, type Deployment } from "./types";

export interface DeploymentRepo {
  create(d: Deployment): Promise<void>;
  get(id: string): Promise<Deployment | undefined>;
  update(id: string, patch: Partial<Omit<Deployment, "id" | "owner">>): Promise<void>;
  listByOwner(owner: string, limit?: number): Promise<Deployment[]>;
  countActive(owner: string): Promise<number>;
}

export const OWNER_INDEX = "owner-createdAt";

export class DynamoDeploymentRepo implements DeploymentRepo {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async create(d: Deployment): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: d,
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );
  }

  async get(id: string): Promise<Deployment | undefined> {
    const out = await this.doc.send(new GetCommand({ TableName: this.table, Key: { id } }));
    return out.Item as Deployment | undefined;
  }

  async update(id: string, patch: Partial<Omit<Deployment, "id" | "owner">>): Promise<void> {
    const entries = Object.entries({ ...patch, updatedAt: new Date().toISOString() }).filter(
      ([, v]) => v !== undefined,
    );
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets: string[] = [];
    entries.forEach(([k, v], i) => {
      names[`#k${i}`] = k; // "status" is a DynamoDB reserved word, so alias every attribute
      values[`:v${i}`] = v;
      sets.push(`#k${i} = :v${i}`);
    });
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { id },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: "attribute_exists(id)",
      }),
    );
  }

  async listByOwner(owner: string, limit = 20): Promise<Deployment[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: OWNER_INDEX,
        KeyConditionExpression: "#o = :o",
        ExpressionAttributeNames: { "#o": "owner" },
        ExpressionAttributeValues: { ":o": owner },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (out.Items ?? []) as Deployment[];
  }

  async countActive(owner: string): Promise<number> {
    const recent = await this.listByOwner(owner, 50);
    return recent.filter((d) => ACTIVE_STATUSES.includes(d.status)).length;
  }
}
