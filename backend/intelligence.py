import re
import unicodedata
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from functools import lru_cache


LANGUAGE_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "pa": "Punjabi",
    "unknown": "Unknown",
}

SIMULATED_REPORT_IDS = {
    f"REP-{number}" for number in range(9001, 9026)
}
SIMULATED_INCIDENT_IDS = {
    f"INC-{number}" for number in range(101, 116)
}
SIMULATED_BRIEF_GENERATED_AT = "2026-11-03T22:50:00+05:30"


def is_simulated_record(record):
    if not isinstance(record, dict):
        return False

    if (
        record.get("is_simulated") is True
        or record.get("is_demo") is True
        or record.get("simulated") is True
        or record.get("demo_mode") is True
        or str(record.get("data_classification", "")).casefold()
        in {"demo", "mock", "simulated"}
    ):
        return True

    if record.get("report_id") in SIMULATED_REPORT_IDS:
        return True
    if record.get("incident_id") in SIMULATED_INCIDENT_IDS:
        return True
    return (
        record.get("PK") == "BRIEF#CURRENT"
        and record.get("generated_at") == SIMULATED_BRIEF_GENERATED_AT
    )


TYPE_TERMS = {
    "Flood": {
        "en": ("flood", "flooding", "water is rising", "submerged"),
        "hi": ("बाढ़", "पानी भर", "जलस्तर", "उफान"),
        "pa": ("ਹੜ੍ਹ", "ਪਾਣੀ ਭਰ", "ਪਾਣੀ ਚੜ੍ਹ", "ਜਲ ਪੱਧਰ"),
    },
    "Landslide": {
        "en": ("landslide", "land slide", "rockfall", "debris fell"),
        "hi": ("भूस्खलन", "पहाड़ी दरक", "मलबा गिर"),
        "pa": ("ਜ਼ਮੀਨ ਖਿਸਕ", "ਪਹਾੜ ਖਿਸਕ", "ਮਲਬਾ ਡਿੱਗ"),
    },
    "Blocked Road": {
        "en": ("blocked road", "road blocked", "road closed", "route blocked"),
        "hi": ("रास्ता बंद", "सड़क बंद", "मार्ग बंद"),
        "pa": ("ਰਸਤਾ ਬੰਦ", "ਸੜਕ ਬੰਦ", "ਮਾਰਗ ਬੰਦ"),
    },
}

SEVERITY_TERMS = {
    "Critical": {
        "en": ("critical", "life-threatening"),
        "hi": ("जानलेवा", "जान को खतरा"),
        "pa": ("ਜਾਨਲੇਵਾ", "ਜਾਨ ਨੂੰ ਖ਼ਤਰਾ", "ਜਾਨ ਨੂੰ ਖਤਰਾ"),
    },
    "High": {
        "en": ("severe", "rapidly", "rapid", "danger", "evacuate", "collapsing"),
        "hi": ("तेजी से", "खतरे", "निकासी", "धंस", "बहुत तेज"),
        "pa": ("ਤੇਜ਼ੀ ਨਾਲ", "ਖ਼ਤਰਾ", "ਖਤਰੇ", "ਖਾਲੀ ਕਰ", "ਢਹਿ"),
    },
    "Medium": {
        "en": ("moderate", "partially", "minor flooding"),
        "hi": ("मध्यम", "आंशिक", "कमर तक"),
        "pa": ("ਦਰਮਿਆਨਾ", "ਅੰਸ਼ਕ", "ਅੰਸ਼ਕ"),
    },
    "Low": {
        "en": ("minor", "small amount", "slight"),
        "hi": ("हल्का", "थोड़ा", "कम"),
        "pa": ("ਹਲਕਾ", "ਥੋੜ੍ਹਾ", "ਘੱਟ"),
    },
}

THREAT_TERMS = {
    "Rising water": {
        "en": ("water is rising", "water level", "flood", "flooding"),
        "hi": ("पानी बढ़", "जलस्तर", "बाढ़"),
        "pa": ("ਪਾਣੀ ਵੱਧ", "ਪਾਣੀ ਚੜ੍ਹ", "ਹੜ੍ਹ"),
    },
    "People trapped": {
        "en": ("trapped", "stranded", "stuck"),
        "hi": ("फंसे", "फँसे", "अटके"),
        "pa": ("ਫਸੇ", "ਫਸ ਗਏ", "ਅਟਕੇ"),
    },
    "Road access blocked": {
        "en": ("road blocked", "route blocked", "road closed"),
        "hi": ("रास्ता बंद", "सड़क बंद"),
        "pa": ("ਰਸਤਾ ਬੰਦ", "ਸੜਕ ਬੰਦ"),
    },
    "Slope instability": {
        "en": ("landslide", "rockfall", "boulders falling"),
        "hi": ("भूस्खलन", "पत्थर गिर", "पहाड़ी दरक"),
        "pa": ("ਜ਼ਮੀਨ ਖਿਸਕ", "ਪੱਥਰ ਡਿੱਗ", "ਪਹਾੜ ਖਿਸਕ"),
    },
}

DAMAGE_TERMS = {
    "Road damage": {
        "en": ("road damage", "road collapsed", "road subsided", "road washed"),
        "hi": ("सड़क क्षतिग्रस्त", "सड़क धंस", "सड़क टूट"),
        "pa": ("ਸੜਕ ਨੁਕਸਾਨ", "ਸੜਕ ਧਸ", "ਸੜਕ ਟੁੱਟ"),
    },
    "Bridge damage": {
        "en": ("bridge damaged", "bridge collapsed", "bridge washed"),
        "hi": ("पुल क्षतिग्रस्त", "पुल टूट", "पुल बह"),
        "pa": ("ਪੁਲ ਨੁਕਸਾਨ", "ਪੁਲ ਟੁੱਟ", "ਪੁਲ ਵਹਿ"),
    },
    "Building damage": {
        "en": ("building collapsed", "house collapsed", "building damaged"),
        "hi": ("इमारत गिर", "मकान गिर", "घर क्षतिग्रस्त"),
        "pa": ("ਇਮਾਰਤ ਡਿੱਗ", "ਘਰ ਡਿੱਗ", "ਮਕਾਨ ਨੁਕਸਾਨ"),
    },
    "Power outage or damage": {
        "en": ("power outage", "power poles", "electricity line"),
        "hi": ("बिजली गुल", "बिजली के खंभे", "बिजली लाइन"),
        "pa": ("ਬਿਜਲੀ ਬੰਦ", "ਬਿਜਲੀ ਦੇ ਖੰਭੇ", "ਬਿਜਲੀ ਲਾਈਨ"),
    },
}

RESOURCE_TERMS = {
    "Rescue team": {
        "en": ("rescue team", "rescue workers", "rescue"),
        "hi": ("बचाव दल", "राहत दल", "रेस्क्यू"),
        "pa": ("ਬਚਾਅ ਟੀਮ", "ਰਾਹਤ ਟੀਮ", "ਬਚਾਅ ਦਲ"),
    },
    "Ambulance": {
        "en": ("ambulance", "medical transport"),
        "hi": ("एम्बुलेंस", "अस्पताल"),
        "pa": ("ਐਂਬੂਲੈਂਸ", "ਹਸਪਤਾਲ"),
    },
    "Medical supplies": {
        "en": ("medical supplies", "medicine", "medical aid"),
        "hi": ("दवाइ", "चिकित्सा सहायता", "मेडिकल"),
        "pa": ("ਦਵਾਈ", "ਡਾਕਟਰੀ ਸਹਾਇਤਾ", "ਮੈਡੀਕਲ"),
    },
    "Food and water": {
        "en": ("food and water", "drinking water", "food supplies"),
        "hi": ("खाने", "भोजन", "पीने का पानी", "पानी चाहिए"),
        "pa": ("ਭੋਜਨ", "ਖਾਣਾ", "ਪੀਣ ਵਾਲਾ ਪਾਣੀ", "ਪਾਣੀ ਚਾਹੀਦਾ"),
    },
    "Temporary shelter": {
        "en": ("shelter", "shelters", "temporary housing"),
        "hi": ("आश्रय", "शरण", "रहने की जगह"),
        "pa": ("ਪਨਾਹ", "ਆਸਰਾ", "ਰਹਿਣ ਦੀ ਥਾਂ"),
    },
}

LATIN_LANGUAGE_HINTS = {
    "hi": {"hai", "hain", "paani", "sadak", "madad", "bachao", "barish", "nadi"},
    "pa": {"aa", "han", "paani", "bachao", "madad", "sarak", "pind"},
}

PLACE_ALIASES = {
    "Mandi": ("मंडी", "ਮੰਡੀ"),
    "Jogindarnagar": ("जोगिंदरनगर", "ਜੋਗਿੰਦਰਨਗਰ"),
    "Kullu": ("कुल्लू", "ਕੁੱਲੂ"),
    "Manali": ("मनाली", "ਮਨਾਲੀ"),
    "Shimla": ("शिमला", "ਸ਼ਿਮਲਾ"),
    "Dharamshala": ("धर्मशाला", "ਧਰਮਸ਼ਾਲਾ"),
    "Pandoh": ("पंडोह", "ਪੰਡੋਹ"),
    "Aut": ("औट", "ਔਟ"),
    "Chamba": ("चंबा", "ਚੰਬਾ"),
    "Bilaspur": ("बिलासपुर", "ਬਿਲਾਸਪੁਰ"),
    "Hamirpur": ("हमीरपुर", "ਹਮੀਰਪੁਰ"),
    "Solan": ("सोलन", "ਸੋਲਨ"),
    "Rampur Bushahr": ("रामपुर बुशहर", "ਰਾਮਪੁਰ ਬੁਸ਼ਹਿਰ"),
    "Reckong Peo": ("रिकांग पिओ", "ਰਿਕਾਂਗ ਪਿਓ"),
    "Keylong": ("केलांग", "ਕੇਲਾਂਗ"),
}


def detect_language(text):
    text = text or ""
    meaningful = [
        char for char in text
        if char.isalpha() and not char.isspace()
    ]
    if not meaningful:
        return {"code": "unknown", "name": "Unknown", "confidence": 0.0}

    devanagari = sum("\u0900" <= char <= "\u097f" for char in meaningful)
    gurmukhi = sum("\u0a00" <= char <= "\u0a7f" for char in meaningful)
    if devanagari / len(meaningful) >= 0.2:
        return {
            "code": "hi",
            "name": "Hindi",
            "confidence": 0.98,
            "method": "Script detection",
        }
    if gurmukhi / len(meaningful) >= 0.2:
        return {
            "code": "pa",
            "name": "Punjabi",
            "confidence": 0.98,
            "method": "Script detection",
        }

    words = set(re.findall(r"[a-z]+", text.casefold()))
    roman_hints = {
        language: len(words & hints)
        for language, hints in LATIN_LANGUAGE_HINTS.items()
    }
    if max(roman_hints.values(), default=0) >= 2:
        language = max(roman_hints, key=roman_hints.get)
        if roman_hints[language] > roman_hints["hi" if language == "pa" else "pa"]:
            return {
                "code": language,
                "name": LANGUAGE_NAMES[language],
                "confidence": 0.55,
                "method": "Romanized vocabulary heuristic",
            }

    latin = sum("LATIN" in unicodedata.name(char, "") for char in meaningful)
    if latin / len(meaningful) >= 0.8:
        return {
            "code": "en",
            "name": "English",
            "confidence": 0.75,
            "method": "Latin-script heuristic",
        }
    return {
        "code": "unknown",
        "name": "Unknown",
        "confidence": 0.0,
        "method": "Insufficient evidence",
    }


def _contains_any(text, terms):
    normalized = text.casefold()
    return [term for term in terms if term.casefold() in normalized]


def _evidence_field(value, evidence, confidence):
    return {
        "value": value,
        "evidence": evidence,
        "confidence": confidence,
        "verification_status": "Unverified",
    }


def _extract_number_people(text):
    number_pattern = r"(\d{1,5}|[०-९]{1,5})"
    people_terms = (
        r"people|persons|person|families|family|children|people affected|"
        r"लोग|व्यक्ति|परिवार|बच्चे|प्रभावित|ਲੋਕ|ਵਿਅਕਤੀ|ਪਰਿਵਾਰ|ਬੱਚੇ|ਪ੍ਰਭਾਵਿਤ"
    )
    match = re.search(
        rf"{number_pattern}\s*(?:{people_terms})|(?:{people_terms})\s*{number_pattern}",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return _evidence_field("Unknown", [], 0.0)
    value = next((group for group in match.groups() if group and group[0].isdigit()), None)
    if value and not value.isascii():
        value = "".join(str(unicodedata.digit(char)) for char in value)
    return _evidence_field(
        int(value),
        [match.group(0)],
        0.9,
    )


def _find_location(text, known_places):
    normalized = text.casefold()
    exact = []
    matched_aliases = {}
    for place in known_places:
        aliases = (place, *PLACE_ALIASES.get(place, ()))
        matches = [
            alias for alias in aliases
            if re.search(rf"(?<!\w){re.escape(alias.casefold())}(?!\w)", normalized)
        ]
        if matches:
            exact.append(place)
            matched_aliases[place] = matches[0]
    exact = list(dict.fromkeys(exact))
    if len(exact) == 1:
        return _evidence_field(
            exact[0],
            [matched_aliases[exact[0]]],
            0.98,
        )
    if len(exact) > 1:
        return _evidence_field("Unknown", exact, 0.0)

    words = re.findall(r"[a-zA-Z][a-zA-Z -]{2,}", text)
    candidates = []
    for word in words:
        token = word.strip()
        for place in known_places:
            score = SequenceMatcher(None, token.casefold(), place.casefold()).ratio()
            if score >= 0.88:
                candidates.append((score, place, token))
    candidates.sort(reverse=True)
    if candidates and (
        len(candidates) == 1 or candidates[0][0] > candidates[1][0]
    ):
        score, place, token = candidates[0]
        return _evidence_field(place, [token], round(score, 2))
    return _evidence_field("Unknown", [], 0.0)


def extract_report_fields(text, known_places):
    text = text or ""
    language = detect_language(text)["code"]
    search_languages = [language] if language in ("en", "hi", "pa") else ["en", "hi", "pa"]

    matched_types = []
    for incident_type, translations in TYPE_TERMS.items():
        evidence = [
            term
            for code in search_languages
            for term in _contains_any(text, translations[code])
        ]
        if evidence:
            matched_types.append((incident_type, evidence))

    incident_type = (
        _evidence_field(matched_types[0][0], matched_types[0][1], 0.85)
        if len(matched_types) == 1
        else _evidence_field("Unknown", [], 0.0)
    )

    matched_severities = []
    for severity, translations in SEVERITY_TERMS.items():
        evidence = [
            term
            for code in search_languages
            for term in _contains_any(text, translations[code])
        ]
        if evidence:
            matched_severities.append((severity, evidence))
    selected_severity = (
        matched_severities[0]
        if len(matched_severities) == 1
        else (None, [])
    )

    def extract_categories(term_catalog):
        found = []
        evidence = []
        for label, translations in term_catalog.items():
            matches = [
                term
                for code in search_languages
                for term in _contains_any(text, translations[code])
            ]
            if matches:
                found.append(label)
                evidence.extend(matches)
        return _evidence_field(
            found if found else "Unknown",
            list(dict.fromkeys(evidence)),
            0.75 if found else 0.0,
        )

    return {
        "incident_type": incident_type,
        "location": _find_location(text, known_places),
        "severity": _evidence_field(
            selected_severity[0] or "Unknown",
            selected_severity[1],
            0.8 if selected_severity[0] else 0.0,
        ),
        "people_affected": _extract_number_people(text),
        "immediate_threats": extract_categories(THREAT_TERMS),
        "infrastructure_damage": extract_categories(DAMAGE_TERMS),
        "urgent_resource_requirements": extract_categories(RESOURCE_TERMS),
    }


@lru_cache(maxsize=2)
def _load_translation_model(direction):
    import torch
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
    from IndicTransToolkit import IndicProcessor

    model_name = (
        "ai4bharat/indictrans2-indic-en-dist-200M"
        if direction == "indic-en"
        else "ai4bharat/indictrans2-en-indic-dist-200M"
    )
    tokenizer = AutoTokenizer.from_pretrained(
        model_name,
        trust_remote_code=True,
    )
    model = AutoModelForSeq2SeqLM.from_pretrained(
        model_name,
        trust_remote_code=True,
    ).to("cpu")
    model.eval()
    return torch, tokenizer, model, IndicProcessor(inference=True)


def translate_text(text, source_language, target_language="en"):
    if source_language == target_language:
        return {
            "text": text,
            "status": "Unchanged",
            "model": "none",
            "error": None,
        }
    if source_language not in ("hi", "pa", "en") or target_language not in (
        "hi",
        "pa",
        "en",
    ):
        return {
            "text": None,
            "status": "Unavailable",
            "model": None,
            "error": "Unsupported or unknown language.",
        }

    direction = "indic-en" if source_language in ("hi", "pa") else "en-indic"
    model_name = (
        "ai4bharat/indictrans2-indic-en-dist-200M"
        if direction == "indic-en"
        else "ai4bharat/indictrans2-en-indic-dist-200M"
    )
    source_codes = {"hi": "hin_Deva", "pa": "pan_Guru", "en": "eng_Latn"}
    target_codes = {"hi": "hin_Deva", "pa": "pan_Guru", "en": "eng_Latn"}
    try:
        torch, tokenizer, model, processor = _load_translation_model(direction)
        prepared = processor.preprocess_batch(
            [text],
            src_lang=source_codes[source_language],
            tgt_lang=target_codes[target_language],
        )
        inputs = tokenizer(
            prepared,
            truncation=True,
            padding="longest",
            return_tensors="pt",
            return_attention_mask=True,
        )
        with torch.inference_mode():
            output = model.generate(
                **inputs,
                use_cache=True,
                min_length=0,
                max_length=256,
                num_beams=4,
                num_return_sequences=1,
            )
        decoded = tokenizer.batch_decode(
            output,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=True,
        )
        translated = processor.postprocess_batch(
            decoded,
            lang=target_codes[target_language],
        )[0].strip()
        return {
            "text": translated or None,
            "status": "Completed" if translated else "Failed",
            "model": model_name,
            "error": None if translated else "Translation model returned empty text.",
        }
    except Exception as error:
        return {
            "text": None,
            "status": "Failed",
            "model": model_name,
            "error": str(error),
        }


def process_report(text, known_places, source_language=None):
    language = (
        {
            "code": source_language,
            "name": LANGUAGE_NAMES.get(source_language, "Unknown"),
            "confidence": None,
            "method": "Whisper language detection",
        }
        if source_language in ("en", "hi", "pa")
        else detect_language(text)
    )
    translation = translate_text(text, language["code"], "en")
    return {
        "pipeline_version": "1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "verification_status": "Unverified",
        "language": language,
        "translation": {
            "text": translation["text"],
            "status": translation["status"],
            "model": translation["model"],
            "error": translation["error"],
        },
        "fields": extract_report_fields(text, known_places),
    }


def _normalize_similarity_text(text):
    text = unicodedata.normalize("NFKC", text or "").casefold()
    return " ".join(re.findall(r"\w+", text))


def _token_similarity(left, right):
    left_tokens = set(_normalize_similarity_text(left).split())
    right_tokens = set(_normalize_similarity_text(right).split())
    if not left_tokens or not right_tokens:
        return 0.0
    overlap = len(left_tokens & right_tokens) / len(left_tokens | right_tokens)
    sequence = SequenceMatcher(
        None,
        _normalize_similarity_text(left),
        _normalize_similarity_text(right),
    ).ratio()
    return round(max(overlap, sequence), 3)


def _contradictory_evidence(left_text, right_text):
    evidence_sets = [
        (
            "Water level",
            ("water is rising", "water rising", "पानी बढ़", "ਪਾਣੀ ਵੱਧ", "ਪਾਣੀ ਚੜ੍ਹ"),
            ("water is not rising", "water is falling", "no rising water", "पानी नहीं बढ़", "ਪਾਣੀ ਨਹੀਂ ਵੱਧ"),
        ),
        (
            "Road access",
            ("road blocked", "road closed", "रास्ता बंद", "सड़क बंद", "ਰਸਤਾ ਬੰਦ", "ਸੜਕ ਬੰਦ"),
            ("road open", "road clear", "रास्ता खुला", "सड़क खुली", "ਰਸਤਾ ਖੁੱਲ੍ਹਾ", "ਸੜਕ ਖੁੱਲ੍ਹੀ"),
        ),
        (
            "Infrastructure damage",
            ("damaged", "collapsed", "washed away", "क्षतिग्रस्त", "टूट गया", "ਨੁਕਸਾਨ", "ਟੁੱਟ ਗਿਆ"),
            ("no damage", "not damaged", "not collapsed", "intact", "कोई नुकसान नहीं", "नहीं टूटा", "ਨੁਕਸਾਨ ਨਹੀਂ", "ਨਹੀਂ ਟੁੱਟਿਆ"),
        ),
        (
            "People trapped",
            ("people trapped", "people are trapped", "लोग फंसे", "ਲੋਕ ਫਸੇ"),
            ("no one trapped", "nobody trapped", "कोई नहीं फंसा", "ਕੋਈ ਨਹੀਂ ਫਸਿਆ"),
        ),
    ]
    left_normalized = (left_text or "").casefold()
    right_normalized = (right_text or "").casefold()
    conflicts = []
    for label, positive_terms, negative_terms in evidence_sets:
        left_negative = [term for term in negative_terms if term.casefold() in left_normalized]
        right_negative = [term for term in negative_terms if term.casefold() in right_normalized]
        left_positive = [
            term for term in positive_terms
            if term.casefold() in left_normalized
            and not any(
                term.casefold() in negative.casefold()
                for negative in left_negative
            )
        ]
        right_positive = [
            term for term in positive_terms
            if term.casefold() in right_normalized
            and not any(
                term.casefold() in negative.casefold()
                for negative in right_negative
            )
        ]
        if (left_positive and right_negative) or (left_negative and right_positive):
            conflicts.append({
                "topic": label,
                "left_evidence": left_positive + left_negative,
                "right_evidence": right_positive + right_negative,
            })
    return conflicts


def compare_reports(reports, incidents, places, window_minutes=60):
    incident_by_id = {incident.get("incident_id"): incident for incident in incidents}
    coordinate_by_place = {
        (place.get("place") or place.get("name", "")).casefold(): place
        for place in places
        if isinstance(place.get("place") or place.get("name"), str)
    }
    parsed = [
        (report, parse_timestamp(report.get("created_at")))
        for report in reports
    ]
    parsed = [entry for entry in parsed if entry[1]]
    parsed.sort(key=lambda entry: entry[1])
    results = []
    for index, (left, left_time) in enumerate(parsed):
        for right, right_time in parsed[index + 1:]:
            delta_minutes = (right_time - left_time).total_seconds() / 60
            if delta_minutes > window_minutes:
                break
            if left.get("report_id") == right.get("report_id"):
                continue

            left_place = (left.get("place") or "").casefold()
            right_place = (right.get("place") or "").casefold()
            same_location = bool(left_place and left_place == right_place)
            nearby = False
            if not same_location and left_place in coordinate_by_place and right_place in coordinate_by_place:
                nearby = distance_km(
                    coordinate_by_place[left_place],
                    coordinate_by_place[right_place],
                ) <= 25
            if not same_location and not nearby:
                continue

            left_comparison_text = (
                left.get("translated_text") or left.get("original_text", "")
            )
            right_comparison_text = (
                right.get("translated_text") or right.get("original_text", "")
            )
            similarity = _token_similarity(
                left_comparison_text,
                right_comparison_text,
            )
            same_type = bool(
                left.get("type")
                and right.get("type")
                and left["type"].casefold() == right["type"].casefold()
            )
            severity_conflict = bool(
                left.get("severity")
                and right.get("severity")
                and left["severity"] != right["severity"]
            )
            contradictory_evidence = _contradictory_evidence(
                left.get("original_text", ""),
                right.get("original_text", ""),
            )
            duplicate_candidate = same_type and similarity >= 0.55
            has_conflict = severity_conflict or bool(contradictory_evidence)
            if not duplicate_candidate and not has_conflict and similarity < 0.3:
                continue

            left_incident = incident_by_id.get(left.get("incident_id"), {})
            right_incident = incident_by_id.get(right.get("incident_id"), {})
            left_rejected = left.get("verification_status") == "Rejected"
            right_rejected = right.get("verification_status") == "Rejected"
            if severity_conflict:
                classification = "Conflicting Severity"
            elif contradictory_evidence:
                classification = "Possible Contradiction"
            elif duplicate_candidate:
                classification = "Potential Duplicate"
            else:
                classification = "Possible Contradiction"
            evidence = [
                f"Reports are {delta_minutes:.0f} minutes apart (window: {window_minutes} minutes).",
                "Locations are the same." if same_location else "Locations are within 25 km.",
                (
                    f"Normalized text similarity score: {similarity:.3f}; "
                    "uses English translations when available, otherwise original text."
                ),
            ]
            if severity_conflict:
                evidence.append(
                    f"Severity differs: {left.get('severity')} vs {right.get('severity')}."
                )
            for conflict in contradictory_evidence:
                evidence.append(
                    f"{conflict['topic']} statements conflict: "
                    f"{', '.join(conflict['left_evidence']) or 'negative evidence'} "
                    f"vs {', '.join(conflict['right_evidence']) or 'negative evidence'}."
                )
            if left_rejected or right_rejected:
                evidence.append("At least one compared report has been human-rejected.")
            if left_incident and right_incident and left_incident.get("incident_id") == right_incident.get("incident_id"):
                evidence.append("Both reports are associated with the same incident.")
            results.append({
                "classification": classification,
                "report_ids": [left.get("report_id"), right.get("report_id")],
                "incident_ids": list(dict.fromkeys([
                    left.get("incident_id"),
                    right.get("incident_id"),
                ])),
                "location": left.get("place") if same_location else [
                    left.get("place"),
                    right.get("place"),
                ],
                "time_difference_minutes": round(delta_minutes, 1),
                "text_similarity": similarity,
                "severity_conflict": severity_conflict,
                "contradictory_evidence": contradictory_evidence,
                "supports_incident": bool(
                    left.get("incident_id")
                    and left.get("incident_id") == right.get("incident_id")
                    and not left_rejected
                    and not right_rejected
                    and not has_conflict
                ),
                "contradicts_incident": bool(
                    left.get("incident_id")
                    and left.get("incident_id") == right.get("incident_id")
                    and has_conflict
                ),
                "recommendation": (
                    "Review both original reports; similarity is not confirmation."
                ),
                "reasoning": evidence,
            })
    return sorted(
        results,
        key=lambda item: (
            item["classification"] != "Conflicting Severity",
            -item["text_similarity"],
        ),
    )


def parse_timestamp(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def distance_km(left, right):
    try:
        import math

        lat1 = math.radians(float(left["lat"]))
        lat2 = math.radians(float(right["lat"]))
        delta_lat = lat2 - lat1
        delta_lng = math.radians(float(right["lng"]) - float(left["lng"]))
        value = (
            math.sin(delta_lat / 2) ** 2
            + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
        )
        return 6371 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))
    except (KeyError, TypeError, ValueError):
        return float("inf")


def detect_emerging_patterns(reports, incidents, places, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)
    recent_cutoff = now - timedelta(hours=24)
    operational_reports = [
        report for report in reports
        if not is_simulated_record(report)
        and report.get("verification_status") != "Rejected"
    ]
    valid_times = [
        parse_timestamp(report.get("created_at"))
        for report in operational_reports
    ]
    recent_reports = [
        report for report in operational_reports
        if (timestamp := parse_timestamp(report.get("created_at")))
        and recent_cutoff <= timestamp <= now
    ]
    if not recent_reports:
        stale_count = sum(
            1 for timestamp in valid_times
            if timestamp and timestamp < recent_cutoff
        )
        data_status = "stale" if stale_count else "insufficient"
        return {
            "label": (
                "Stale evidence — no reports from the last 24 hours; "
                "no current emerging patterns are shown."
                if data_status == "stale"
                else "Insufficient recent evidence — no current emerging patterns are shown."
            ),
            "data_status": data_status,
            "stale_report_count": stale_count,
            "evaluated_at": now.isoformat(),
            "detected_at": now.isoformat(),
            "patterns": [],
        }

    as_of = now
    window = timedelta(minutes=60)
    place_by_name = {
        (place.get("place") or place.get("name", "")).casefold(): place
        for place in places
        if isinstance(place.get("place") or place.get("name"), str)
    }
    reports_by_place = {}
    for report in recent_reports:
        place = report.get("place")
        timestamp = parse_timestamp(report.get("created_at"))
        if place and timestamp and recent_cutoff <= timestamp <= now:
            reports_by_place.setdefault(place.casefold(), []).append((report, timestamp))

    patterns = []
    for place, values in reports_by_place.items():
        current = [
            (report, timestamp)
            for report, timestamp in values
            if as_of - window <= timestamp <= as_of
        ]
        previous = [
            (report, timestamp)
            for report, timestamp in values
            if as_of - 2 * window <= timestamp < as_of - window
        ]
        if len(current) >= 3 and len(current) > max(1, len(previous) * 2):
            ids = [report["report_id"] for report, _ in current]
            patterns.append({
                "type": "Report Frequency Increase",
                "description": (
                    f"{place.title()} has {len(current)} reports in the latest "
                    f"60-minute window versus {len(previous)} in the prior window."
                ),
                "locations": [place_by_name.get(place, {}).get("place", place.title())],
                "supporting_report_ids": ids,
                "current_count": len(current),
                "previous_count": len(previous),
                "detected_at": now.isoformat(),
                "evidence_strength": (
                    f"Observed counts only ({len(current)} vs {len(previous)}); "
                    "heuristic threshold, not a validated prediction."
                ),
                "confidence": "Moderate" if len(current) >= 5 else "Limited",
            })

        high = [
            (report, timestamp)
            for report, timestamp in values
            if report.get("severity") in ("High", "Critical")
            and as_of - timedelta(hours=24) <= timestamp <= as_of
        ]
        if len(high) >= 2:
            patterns.append({
                "type": "Multiple High-Severity Reports",
                "description": (
                    f"{len(high)} non-rejected reports at {place.title()} are "
                    "marked High or Critical in the last 24 hours."
                ),
                "locations": [place_by_name.get(place, {}).get("place", place.title())],
                "supporting_report_ids": [
                    report["report_id"] for report, _ in high
                ],
                "current_count": len(high),
                "previous_count": None,
                "detected_at": now.isoformat(),
                "evidence_strength": "Based on stored severity labels; human review required.",
                "confidence": "Limited",
            })

    damage_terms = (
        "damaged",
        "collapsed",
        "washed away",
        "सड़क क्षतिग्रस्त",
        "पुल टूट",
        "ਸੜਕ ਨੁਕਸਾਨ",
        "ਪੁਲ ਟੁੱਟ",
    )
    for place, values in reports_by_place.items():
        damage_reports = [
            report for report, _ in values
            if any(
                term.casefold() in (report.get("original_text") or "").casefold()
                for term in damage_terms
            )
        ]
        if len(damage_reports) >= 2:
            patterns.append({
                "type": "Repeated Infrastructure Damage Reports",
                "description": (
                    f"{len(damage_reports)} reports from {place.title()} mention "
                    "infrastructure damage."
                ),
                "locations": [place_by_name.get(place, {}).get("place", place.title())],
                "supporting_report_ids": [
                    report["report_id"] for report in damage_reports
                ],
                "current_count": len(damage_reports),
                "previous_count": None,
                "detected_at": now.isoformat(),
                "evidence_strength": "Keyword-based report evidence; verify against originals.",
                "confidence": "Limited",
            })

    # Nearby incidents are reported as a descriptive cluster, never as a forecast.
    incident_groups = {}
    for incident in incidents:
        if (
            is_simulated_record(incident)
            or incident.get("status") == "Rejected"
            or incident.get("response_status") == "Resolved"
        ):
            continue
        if not set(incident.get("report_ids", [])) & {
            report.get("report_id") for report in recent_reports
        }:
            continue
        place = (incident.get("place") or "").casefold()
        if place in place_by_name:
            incident_groups.setdefault(place, []).append(incident)
    cluster_locations = []
    for place, values in incident_groups.items():
        related = [
            other
            for other in incident_groups
            if other != place
            and distance_km(place_by_name[place], place_by_name[other]) <= 35
        ]
        if related:
            cluster_locations.append(place)
    if len(cluster_locations) >= 2:
        members = list(dict.fromkeys(
            place
            for location in cluster_locations
            for place in [location, *[
                candidate for candidate in incident_groups
                if candidate != location
                and distance_km(place_by_name[location], place_by_name[candidate]) <= 35
            ]]
        ))
        cluster_incidents = [
            incident
            for place in members
            for incident in incident_groups.get(place, [])
        ]
        patterns.append({
            "type": "Nearby Incident Cluster",
            "description": (
                f"{len(cluster_incidents)} stored incidents are recorded across "
                f"{len(members)} locations within 35 km."
            ),
            "locations": [
                place_by_name[place].get("place", place.title())
                for place in members
            ],
            "supporting_report_ids": list(dict.fromkeys(
                report_id
                for incident in cluster_incidents
                for report_id in incident.get("report_ids", [])
            )),
            "current_count": len(cluster_incidents),
            "previous_count": None,
            "detected_at": now.isoformat(),
            "evidence_strength": "Geographic proximity and stored incident counts only.",
            "confidence": "Limited",
        })

    return {
        "label": (
            "Current observed anomaly indicators; not validated disaster predictions."
            if patterns
            else "Insufficient recent evidence for a pattern; not a disaster prediction."
        ),
        "data_status": "current" if patterns else "insufficient",
        "stale_report_count": sum(
            1 for timestamp in valid_times
            if timestamp and timestamp < recent_cutoff
        ),
        "evaluated_at": now.isoformat(),
        "detected_at": now.isoformat(),
        "as_of": as_of.isoformat(),
        "window_minutes": 60,
        "patterns": patterns,
    }
