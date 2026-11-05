"""Greeting text of a new chat: a pure function of the slot statuses."""

import pytest

from app.services.chat_texts import greeting_for

NEW = (
    "Hallo! Ich helfe Ihnen bei der Vorbereitung des Kundenworkshops. Gemeinsam erstellen wir "
    "drei Artefakte. Sie können mir zunächst Fragen zu den Kundendokumenten stellen oder direkt "
    "mit der Projektbeschreibung beginnen."
)


@pytest.mark.parametrize(
    ("statuses", "expected"),
    [
        (("not_started", "not_started", "not_started"), NEW),
        (
            ("draft", "not_started", "not_started"),
            "Willkommen zurück. Als Nächstes folgt die Projektbeschreibung.",
        ),
        (
            ("approved", "not_started", "not_started"),
            "Willkommen zurück. Als Nächstes folgt die Stakeholder-Analyse.",
        ),
        (
            ("approved", "draft", "not_started"),
            "Willkommen zurück. Als Nächstes folgt die Stakeholder-Analyse.",
        ),
        (
            ("approved", "approved", "not_started"),
            "Willkommen zurück. Als Nächstes folgen die offenen Punkte.",
        ),
        (
            ("approved", "approved", "draft"),
            "Willkommen zurück. Als Nächstes folgen die offenen Punkte.",
        ),
        (
            ("draft", "approved", "approved"),
            "Willkommen zurück. Als Nächstes folgt die Projektbeschreibung.",
        ),
        (
            ("not_started", "approved", "approved"),
            "Willkommen zurück. Als Nächstes folgt die Projektbeschreibung.",
        ),
        (
            ("approved", "approved", "approved"),
            "Willkommen zurück. Alle drei Artefakte sind freigegeben.",
        ),
    ],
)
def test_greeting_for(statuses: tuple[str, str, str], expected: str) -> None:
    slots = [("01", statuses[0]), ("02", statuses[1]), ("03", statuses[2])]
    assert greeting_for(slots) == expected


def test_greeting_does_not_depend_on_the_order_of_the_pairs() -> None:
    slots = [("03", "not_started"), ("01", "approved"), ("02", "draft")]
    assert greeting_for(slots) == "Willkommen zurück. Als Nächstes folgt die Stakeholder-Analyse."
