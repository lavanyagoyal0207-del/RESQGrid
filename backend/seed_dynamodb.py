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


def seed_places(places, save=save_once):
    for place in places:
        if isinstance(place, dict):
            place_name = place.get("name") or place.get("place")
            place_data = place
        else:
            place_name = str(place)
            place_data = {"name": place_name}

        if not place_name:
            print("Skipped place without a name:", place)
            continue

        save({
            "PK": f"PLACE#{place_name}",
            "SK": "METADATA",
            **place_data
        })


def main():
    with open(DATA_PATH, "r", encoding="utf-8") as file:
        state = json.load(file, parse_float=Decimal)

    # mockData.json contains simulated incidents and reports; only fixed
    # location reference data is safe to initialize in operational storage.
    seed_places(state.get("places", []), save=save_once)
    print("\nFixed locations initialized. Simulated reports were not saved.")


if __name__ == "__main__":
    main()
