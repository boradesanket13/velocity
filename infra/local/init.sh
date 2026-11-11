#!/bin/sh
set -eu

S3="--endpoint-url ${AWS_ENDPOINT_URL_S3}"
DDB="--endpoint-url ${AWS_ENDPOINT_URL_DYNAMODB}"
SQS="--endpoint-url ${AWS_ENDPOINT_URL_SQS}"

wait_for() {
  name="$1"; shift
  i=0
  until "$@" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge 60 ]; then echo "timed out waiting for $name" >&2; exit 1; fi
    echo "waiting for $name..."
    sleep 2
  done
}

wait_for minio    aws $S3  s3api list-buckets
wait_for dynamodb aws $DDB dynamodb list-tables
wait_for elasticmq aws $SQS sqs list-queues

for b in "$SITES_BUCKET" "$ARTIFACTS_BUCKET"; do
  aws $S3 s3api create-bucket --bucket "$b" >/dev/null 2>&1 || true
  echo "bucket ready: $b"
done

aws $DDB dynamodb create-table \
  --table-name "$DEPLOYMENTS_TABLE" \
  --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=id,AttributeType=S AttributeName=owner,AttributeType=S AttributeName=createdAt,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes 'IndexName=owner-createdAt,KeySchema=[{AttributeName=owner,KeyType=HASH},{AttributeName=createdAt,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
  >/dev/null 2>&1 || true
echo "table ready: $DEPLOYMENTS_TABLE"

echo "local infrastructure ready"
