import boto3

REGION = "ap-south-1"

dynamodb = boto3.resource(
    "dynamodb",
    region_name=REGION
)

s3 = boto3.client(
    "s3",
    region_name=REGION
)

table = dynamodb.Table("ResQGrid")

print("AWS connected successfully!")
