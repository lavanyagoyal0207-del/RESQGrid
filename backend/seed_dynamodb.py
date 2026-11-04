import json
from decimal import Decimal
from pathlib import Path

from botocore.exceptions import ClientError
from aws_config import table

DATA_PATH = (
    Path(__file__).resolve().parent
    / ".."
    / "src"
    / "data"
    / "mockData.json"
)

# Read JSON numbers as Decimal because DynamoDB does not accept Python floats.
with open(DATA_PATH, "r", encoding="utf-8") as file:
    state = json.load(file, parse_float=Decimal)


def save_once(item):
    try:
        table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(PK) AND attribute_not_exists(SK)"
        )
        print("Saved:", item["PK"])

    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            print("Already exists, skipped:", item["PK"])
        else:
            raise


# Save reports
for report in state.get("reports", []):
    report_id = report["report_id"]

    save_once({
        "PK": f"REPORT#{report_id}",
        "SK": "METADATA",
        **report
    })


# Save incidents
for incident in state.get("incidents", []):
    incident_id = incident["incident_id"]

    save_once({
        "PK": f"INCIDENT#{incident_id}",
        "SK": "METADATA",
        **incident
    })


# Save places
for index, place in enumerate(state.get("places", [])):
    if isinstance(place, dict):
        place_name = place.get("name") or place.get("place")
        place_data = place
    else:
        place_name = str(place)
        place_data = {"name": place_name}

    if not place_name:
        print("Skipped place without a name:", place)
        continue

    save_once({
        "PK": f"PLACE#{place_name}",
        "SK": "METADATA",
        **place_data
    })


# Save the situation brief
if "brief" in state:
    save_once({
        "PK": "BRIEF#CURRENT",
        "SK": "METADATA",
        **state["brief"]
    })

print("\nInitial data migration finished.")