"""Template knowledge for the two paperwork types.

The geometry of every slot is read from the blank template PDFs at runtime
(so a replaced template is picked up automatically).  What lives here is the
*meaning* of each slot: the template widgets are listed in document order and
paired with a semantic key, a human label and the section of the form they
belong to.  Field names on real forms drift; this ordering only has to be right
for the templates themselves.
"""

from __future__ import annotations

# (template field name, semantic key, label, section)
F10_SLOTS = [
    ("Recieving Cadet Name", "recipient_name", "Cadet name", "I · Personnel"),
    ("Recieving Cadet Squadron", "squadron", "Squadron", "I · Personnel"),
    ("Recieving Cadet Year", "class_year", "Class year", "I · Personnel"),
    ("Date", "date", "Date", "I · Personnel"),
    ("Reporting Official", "issuer", "Reporting official", "I · Personnel"),
    ("Reporting Grade", "issuer_grade", "RO grade", "I · Personnel"),
    ("Reporting Org/Office Symbol", "issuer_org", "RO org / office symbol", "I · Personnel"),
    ("RO MFR Attached Yes", "mfr_yes", "RO MFR attached: yes", "I · Personnel"),
    ("RO MFR Attached No", "mfr_no", "RO MFR attached: no", "I · Personnel"),
    ("Conduct Narrative", "narrative", "Conduct narrative", "II · Incident"),
    ("Initial Processing Date", "login_date", "Log-in date", "III · Initial processing"),
    ("SQCCF Initials", "sqccf_initials", "SQ/CCF initials", "III · Initial processing"),
    ("Element Lead Initials", "init_element_initials", "Element leader initials", "III · Initial processing"),
    ("Date Recieved", "date_received", "Date received", "IV · Cadet options"),
    ("Cadet Initials", "cadet_initials", "Cadet initials", "IV · Cadet options"),
    ("Rebuttal Attached Yes", "rebuttal_yes", "MFR attached: yes", "IV · Cadet options"),
    ("Rebuttal Attached No", "rebuttal_no", "MFR attached: no", "IV · Cadet options"),
    ("Element Lead Initials", "coc_element_initials", "Element ldr rec.", "V · Chain of command"),
    ("Element Lead Date", "coc_element_date", "Element ldr date", "V · Chain of command"),
    ("FLTCC Initials", "fltcc_initials", "Cadet FLT/CC rec.", "V · Chain of command"),
    ("FLTCC Date", "fltcc_date", "Cadet FLT/CC date", "V · Chain of command"),
    ("Cadet SQCC Initials", "cadet_sqcc_initials", "Cadet SQ/CC rec.", "V · Chain of command"),
    ("Cadet SQCC Date", "cadet_sqcc_date", "Cadet SQ/CC date", "V · Chain of command"),
    ("SQAOC Initials", "sqaoc_initials", "SQ AOC rec.", "V · Chain of command"),
    ("SQAOC Date", "sqaoc_date", "SQ AOC date", "V · Chain of command"),
    ("GPCC Initials", "gpcc_initials", "GP AOC rec.", "V · Chain of command"),
    ("GPCC Date", "gpcc_date", "GP AOC date", "V · Chain of command"),
    ("CW Initials", "cw_initials", "CW rec.", "V · Chain of command"),
    ("CW Date", "cw_date", "CW date", "V · Chain of command"),
    ("Demerits", "demerits", "Demerits", "VI · Final processing"),
    ("Confinements", "confinements", "Confinements", "VI · Final processing"),
    ("Loss of Pass Priv", "loss_of_pass", "Loss of pass priv", "VI · Final processing"),
    ("Tours", "tours", "Tours", "VI · Final processing"),
    ("POV Priv", "pov_priv", "Revoke POV priv", "VI · Final processing"),
    ("Awarding Official Signature", "sig_awarding", "Awarding official signature", "VI · Final processing"),
    ("Awarding Organization", "awarding_org", "Awarding organization", "VI · Final processing"),
    ("Date Awarded", "date_awarded", "Date awarded", "VI · Final processing"),
    ("Recieving Cadet Signature", "sig_recipient", "Cadet signature", "VI · Final processing"),
    ("Date Counseled", "date_counseled", "Date counseled", "VI · Final processing"),
    ("Date RO Notified", "date_ro_notified", "Date RO notified", "VII · Final coordination"),
    ("AOC Signature", "sig_aoc", "AOC/AMT signature", "VII · Final coordination"),
    ("Date CWVVD Notified", "date_cwvvd_notified", "Date CWVVD notified", "VII · Final coordination"),
]

F174_SLOTS = [
    ("Recieving Name", "recipient_name", "Name", "II · Personal data"),
    ("Recieving Grade", "recipient_grade", "Grade", "II · Personal data"),
    ("Recieving SSN", "ssn", "SSN", "II · Personal data"),
    ("Recieving AFSC", "afsc", "AFSC", "II · Personal data"),
    ("Recieving Duty Phone", "duty_phone", "Duty phone", "II · Personal data"),
    ("Recieving Unit/Office Symbol", "squadron", "Unit / office symbol", "II · Personal data"),
    ("Reason for Counseling", "reason", "Reason for counseling", "II · Personal data"),
    ("Recieving Other Information", "other_info", "Other information", "II · Personal data"),
    ("Couseling Summary", "narrative", "Summary of counseling", "III · Counseling"),
    ("Recommendations and Advice of Counselor", "recommendations", "Recommendations & advice", "III · Counseling"),
    ("Name Grade and Duty Title of Counselor", "issuer", "Counselor", "III · Counseling"),
    ("Counselor Signature", "sig_counselor", "Counselor signature", "III · Counseling"),
    ("Couseling Date_af_date", "date", "Counseling date", "III · Counseling"),
    ("Counselee Comment", "counselee_comment", "Counselee comments", "IV · Acknowledgment"),
    ("Name and Grade of Counselee", "counselee_name", "Counselee name & grade", "IV · Acknowledgment"),
    ("Counselee Signature", "sig_recipient", "Counselee signature", "IV · Acknowledgment"),
    ("Counselee Signature Date_af_date", "counselee_date", "Counselee date", "IV · Acknowledgment"),
    ("Recommended Referral Agencies", "referrals", "Referral agencies", "V · Referral"),
    ("Commanders Comments", "commander_comments", "Commander's comments", "VI · Commander"),
    ("Commander Name and Grade", "commander_name", "Commander", "VI · Commander"),
    ("Commander Signature", "sig_commander", "Commander signature", "VI · Commander"),
    ("Commander Signature Date_af_date", "commander_date", "Commander date", "VI · Commander"),
]

FORM_TYPES = {
    "F10": {
        "title": "AFCW Form 10",
        "subtitle": "Report of Conduct",
        "template_file": "F10_nuked_final.pdf",
        "slots": F10_SLOTS,
        # Which slots are allowed to be missing without calling the form "egregious"
        "core": ["recipient_name", "date", "issuer", "narrative", "sig_recipient", "sig_aoc", "sqccf_initials"],
        "anchor_text": ["REPORT OF CONDUCT", "AFCW"],
    },
    "F174": {
        "title": "AF Form 174",
        "subtitle": "Record of Individual Counseling",
        "template_file": "F174_nuked_final.pdf",
        "slots": F174_SLOTS,
        "core": ["recipient_name", "reason", "narrative", "issuer", "date", "sig_recipient"],
        "anchor_text": ["INDIVIDUAL COUNSELING", "174"],
    },
}

# The four routing checks the first sergeant tracks.  Each maps to the slot(s)
# whose presence of ink/text means "done" for that form type.  A flag with no
# slot on a given form can only be set by hand.
FLAG_DEFS = [
    ("sqccf_processed", "Processed by SQ/CCF"),
    ("cadet_sqcc_signed", "Signed by Cadet SQ/CC"),
    ("recipient_signed", "Signed by recipient"),
    ("aoc_signed", "Signed by AOC/AMT"),
]

FLAG_SLOTS = {
    "F10": {
        "sqccf_processed": ["sqccf_initials", "login_date"],
        "cadet_sqcc_signed": ["cadet_sqcc_initials"],
        "recipient_signed": ["sig_recipient"],
        "aoc_signed": ["sig_aoc"],
    },
    "F174": {
        "sqccf_processed": [],
        "cadet_sqcc_signed": [],  # filled from settings: which role the commander block represents
        "recipient_signed": ["sig_recipient"],
        "aoc_signed": [],
    },
}


def flag_slots(form_type: str, settings: dict) -> dict:
    slots = {k: list(v) for k, v in FLAG_SLOTS.get(form_type, {}).items()}
    if form_type == "F174":
        role = settings.get("f174_commander_role", "cadet_sqcc_signed")
        if role in slots:
            slots[role] = ["sig_commander"]
    return slots
