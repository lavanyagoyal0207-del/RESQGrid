import os

import boto3
from botocore.config import Config

REGION = os.getenv("AWS_REGION", "ap-south-1")
TABLE_NAME = os.getenv("RESQGRID_DYNAMODB_TABLE", "ResQGrid")
BUCKET_NAME = os.getenv("RESQGRID_AUDIO_BUCKET", "resqgrid-audio-230289356936-2026")

AWS_CLIENT_CONFIG = Config(
    connect_timeout=3,
    read_timeout=10,
    retries={"mode": "standard", "max_attempts": 3},
)

dynamodb = boto3.resource(
    "dynamodb",
    region_name=REGION,
    config=AWS_CLIENT_CONFIG,
)

table = dynamodb.Table(TABLE_NAME)

s3 = boto3.client(
    "s3",
    region_name=REGION,
    config=AWS_CLIENT_CONFIG,
)