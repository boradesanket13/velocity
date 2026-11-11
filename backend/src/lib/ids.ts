import { randomInt } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const DEPLOYMENT_ID_LENGTH = 10;

/** DNS-label safe; also enforced in the CloudFront function. */
export const DEPLOYMENT_ID_RE = /^[a-z0-9]{10}$/;

/** 36^10 (~3.6e15) combinations from a CSPRNG: unguessable and collision-free in practice. */
export function newDeploymentId(): string {
  let id = "";
  for (let i = 0; i < DEPLOYMENT_ID_LENGTH; i++) {
    id += ALPHABET[randomInt(ALPHABET.length)];
  }
  return id;
}

export function isDeploymentId(value: string): boolean {
  return DEPLOYMENT_ID_RE.test(value);
}
