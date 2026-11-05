import pytest

from app.agents.base import load_prompt
from app.schemas.run import Slot
from app.services.artifact_templates import OPEN_ISSUES_ITEMS_END, TEMPLATES, get_template


def test_three_slots_with_unique_types() -> None:
    assert [t.slot for t in TEMPLATES] == ["01", "02", "03"]
    assert len({t.type for t in TEMPLATES}) == 3


@pytest.mark.parametrize("slot", ["01", "02", "03"])
def test_the_structure_prompt_contains_what_the_format_check_requires(slot: Slot) -> None:
    template = get_template(slot)
    lines = {line.strip() for line in load_prompt(f"structures/{slot}").splitlines()}

    assert set(template.required_headings) <= lines
    for required in template.required_item_lines:
        assert any(line.startswith(required) for line in lines)


def test_open_issues_require_no_headings_so_chat_added_questions_alone_pass() -> None:
    assert get_template("03").required_headings == ()
    assert OPEN_ISSUES_ITEMS_END in load_prompt("structures/03").splitlines()


def test_open_issues_do_not_require_sources() -> None:
    assert get_template("03").sources_required is False
    assert get_template("01").sources_required is True
