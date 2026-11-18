"""Research JSON canonical form.

Object keys sort by UTF-16 code units. Arrays keep their order.
Solidus, U+2028, and U+2029 stay literal, matching JSON.stringify.
"""

from __future__ import annotations

import hashlib
from typing import Iterable

_I64_MIN = -9223372036854775808
_I64_MAX = 9223372036854775807
_MAX_SAFE = 9007199254740991


class JsonError(ValueError):
    pass


class Json:
    __slots__ = ("kind", "value")

    def __init__(self, kind: str, value: object = None) -> None:
        self.kind = kind
        self.value = value

    @staticmethod
    def null() -> "Json":
        return Json("null")

    @staticmethod
    def bool(value: bool) -> "Json":
        return Json("bool", value)

    @staticmethod
    def int(value: int) -> "Json":
        return Json("int", value)

    @staticmethod
    def string(value: str) -> "Json":
        return Json("string", value)

    @staticmethod
    def array(items: list["Json"]) -> "Json":
        return Json("array", items)

    @staticmethod
    def object(pairs: Iterable[tuple[str, "Json"]]) -> "Json":
        return Json("object", [(key, value) for key, value in pairs])

    def get(self, key: str) -> "Json | None":
        if self.kind != "object":
            return None
        for name, value in self.value:  # type: ignore[union-attr]
            if name == key:
                return value
        return None

    def as_object(self) -> list[tuple[str, "Json"]] | None:
        if self.kind != "object":
            return None
        return self.value  # type: ignore[return-value]

    def as_array(self) -> list["Json"] | None:
        if self.kind != "array":
            return None
        return self.value  # type: ignore[return-value]

    def as_str(self) -> str | None:
        if self.kind != "string":
            return None
        return self.value  # type: ignore[return-value]

    def as_int(self) -> int | None:
        if self.kind != "int":
            return None
        return self.value  # type: ignore[return-value]

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Json):
            return False
        if self.kind != other.kind:
            return False
        if self.kind == "array":
            return self.value == other.value
        if self.kind == "object":
            return self.value == other.value
        return self.value == other.value

    def __repr__(self) -> str:
        return f"Json({self.kind}, {self.value!r})"


def utf16_units(text: str) -> tuple[int, ...]:
    units: list[int] = []
    for char in text:
        code = ord(char)
        if code <= 0xFFFF:
            units.append(code)
        else:
            code -= 0x10000
            units.append(0xD800 + (code >> 10))
            units.append(0xDC00 + (code & 0x3FF))
    return tuple(units)


def utf16_cmp(left: str, right: str) -> int:
    left_units = utf16_units(left)
    right_units = utf16_units(right)
    if left_units < right_units:
        return -1
    if left_units > right_units:
        return 1
    return 0


def parse_json(text: str) -> Json:
    parser = _Parser(text)
    parser.skip()
    value = parser.value()
    parser.skip()
    if parser.index != len(parser.text):
        raise JsonError("trailing JSON")
    return value


def canonicalize(value: Json) -> str:
    out: list[str] = []
    _write_canonical(value, out)
    return "".join(out)


def stringify(value: Json) -> str:
    out: list[str] = []
    _write_stringify(value, out)
    return "".join(out)


def digest_json(value: Json) -> str:
    raw = hashlib.sha256(canonicalize(value).encode("utf-8")).hexdigest()
    return f"sha256-{raw}"


class _Parser:
    def __init__(self, text: str) -> None:
        self.text = text
        self.index = 0

    def skip(self) -> None:
        while self.index < len(self.text) and self.text[self.index] in " \n\r\t":
            self.index += 1

    def value(self) -> Json:
        self.skip()
        if self.index >= len(self.text):
            raise JsonError("truncated JSON")
        char = self.text[self.index]
        if char == "n":
            return self.literal("null", Json.null())
        if char == "t":
            return self.literal("true", Json.bool(True))
        if char == "f":
            return self.literal("false", Json.bool(False))
        if char == '"':
            return Json.string(self.string())
        if char == "[":
            return self.array()
        if char == "{":
            return self.object()
        if char == "-" or char.isdigit():
            return self.number()
        raise JsonError("invalid JSON value")

    def literal(self, text: str, value: Json) -> Json:
        if self.text.startswith(text, self.index):
            self.index += len(text)
            return value
        raise JsonError(f"invalid JSON literal {text}")

    def array(self) -> Json:
        self.index += 1
        items: list[Json] = []
        self.skip()
        if self.eat("]"):
            return Json.array(items)
        while True:
            items.append(self.value())
            self.skip()
            if self.eat("]"):
                return Json.array(items)
            if not self.eat(","):
                raise JsonError("invalid JSON array")

    def object(self) -> Json:
        self.index += 1
        pairs: list[tuple[str, Json]] = []
        self.skip()
        if self.eat("}"):
            return Json.object(pairs)
        while True:
            self.skip()
            if not self.eat('"'):
                raise JsonError("JSON object key must be a string")
            key = self.string_body()
            self.skip()
            if not self.eat(":"):
                raise JsonError("JSON object missing colon")
            value = self.value()
            if any(name == key for name, _ in pairs):
                raise JsonError("duplicate JSON key")
            pairs.append((key, value))
            self.skip()
            if self.eat("}"):
                return Json.object(pairs)
            if not self.eat(","):
                raise JsonError("invalid JSON object")

    def number(self) -> Json:
        start = self.index
        self.eat("-")
        if self.eat("0"):
            if self.index < len(self.text) and self.text[self.index].isdigit():
                raise JsonError("invalid JSON number")
        elif self.index < len(self.text) and self.text[self.index].isdigit():
            while self.index < len(self.text) and self.text[self.index].isdigit():
                self.index += 1
        else:
            raise JsonError("invalid JSON number")
        fractional = False
        if self.eat("."):
            fractional = True
            if self.index >= len(self.text) or not self.text[self.index].isdigit():
                raise JsonError("invalid JSON number")
            while self.index < len(self.text) and self.text[self.index].isdigit():
                self.index += 1
        if self.index < len(self.text) and self.text[self.index] in "eE":
            fractional = True
            self.index += 1
            if self.index < len(self.text) and self.text[self.index] in "+-":
                self.index += 1
            if self.index >= len(self.text) or not self.text[self.index].isdigit():
                raise JsonError("invalid JSON number")
            while self.index < len(self.text) and self.text[self.index].isdigit():
                self.index += 1
        token = self.text[start : self.index]
        if not fractional:
            try:
                parsed = int(token)
            except ValueError as exc:
                raise JsonError(f"JSON integer out of range: {token}") from exc
            if parsed < _I64_MIN or parsed > _I64_MAX:
                raise JsonError(f"JSON integer out of range: {token}")
            return Json.int(parsed)
        number = float(token)
        if number.is_integer() and _I64_MIN <= number <= _I64_MAX:
            whole = int(number)
            if float(whole) == number and abs(float(whole)) <= _MAX_SAFE:
                return Json.int(whole)
        raise JsonError("KAR JSON numbers must be safe integers")

    def string(self) -> str:
        if not self.eat('"'):
            raise JsonError("JSON string expected")
        return self.string_body()

    def string_body(self) -> str:
        out: list[str] = []
        while True:
            if self.index >= len(self.text):
                raise JsonError("unterminated JSON string")
            char = self.text[self.index]
            if char == '"':
                self.index += 1
                return "".join(out)
            if char == "\\":
                self.index += 1
                if self.index >= len(self.text):
                    raise JsonError("truncated JSON escape")
                escape = self.text[self.index]
                self.index += 1
                mapping = {
                    '"': '"',
                    "\\": "\\",
                    "/": "/",
                    "b": "\b",
                    "f": "\f",
                    "n": "\n",
                    "r": "\r",
                    "t": "\t",
                }
                if escape in mapping:
                    out.append(mapping[escape])
                    continue
                if escape == "u":
                    out.append(self.unicode_escape())
                    continue
                raise JsonError("invalid JSON string escape")
            if ord(char) < 0x20:
                raise JsonError("raw control character in JSON string")
            out.append(char)
            self.index += 1

    def unicode_escape(self) -> str:
        unit = self.hex4()
        if 0xD800 <= unit <= 0xDBFF:
            if self.text.startswith("\\u", self.index):
                self.index += 2
                second = self.hex4()
                if 0xDC00 <= second <= 0xDFFF:
                    point = 0x10000 + (((unit - 0xD800) << 10) | (second - 0xDC00))
                    return chr(point)
            raise JsonError("lone JSON surrogate")
        if 0xDC00 <= unit <= 0xDFFF:
            raise JsonError("lone JSON surrogate")
        return chr(unit)

    def hex4(self) -> int:
        end = self.index + 4
        text = self.text[self.index : end]
        if len(text) != 4:
            raise JsonError("truncated JSON unicode escape")
        try:
            value = int(text, 16)
        except ValueError as exc:
            raise JsonError("invalid JSON unicode escape") from exc
        self.index = end
        return value

    def eat(self, char: str) -> bool:
        if self.index < len(self.text) and self.text[self.index] == char:
            self.index += 1
            return True
        return False


def _write_canonical(value: Json, out: list[str]) -> None:
    if value.kind == "array":
        out.append("[")
        for index, item in enumerate(value.value):  # type: ignore[arg-type]
            if index:
                out.append(",")
            _write_canonical(item, out)
        out.append("]")
        return
    if value.kind == "object":
        pairs = sorted(value.value, key=lambda item: utf16_units(item[0]))  # type: ignore[arg-type]
        out.append("{")
        for index, (key, child) in enumerate(pairs):
            if index:
                out.append(",")
            _write_string(key, out)
            out.append(":")
            _write_canonical(child, out)
        out.append("}")
        return
    _write_scalar(value, out)


def _write_stringify(value: Json, out: list[str]) -> None:
    if value.kind == "array":
        out.append("[")
        for index, item in enumerate(value.value):  # type: ignore[arg-type]
            if index:
                out.append(",")
            _write_stringify(item, out)
        out.append("]")
        return
    if value.kind == "object":
        out.append("{")
        for index, (key, child) in enumerate(value.value):  # type: ignore[arg-type]
            if index:
                out.append(",")
            _write_string(key, out)
            out.append(":")
            _write_stringify(child, out)
        out.append("}")
        return
    _write_scalar(value, out)


def _write_scalar(value: Json, out: list[str]) -> None:
    if value.kind == "null":
        out.append("null")
    elif value.kind == "bool":
        out.append("true" if value.value else "false")
    elif value.kind == "int":
        out.append(str(value.value))
    elif value.kind == "string":
        _write_string(value.value, out)  # type: ignore[arg-type]
    else:
        _write_canonical(value, out)


def _write_string(value: str, out: list[str]) -> None:
    out.append('"')
    for char in value:
        if char == '"':
            out.append('\\"')
        elif char == "\\":
            out.append("\\\\")
        elif char == "\b":
            out.append("\\b")
        elif char == "\f":
            out.append("\\f")
        elif char == "\n":
            out.append("\\n")
        elif char == "\r":
            out.append("\\r")
        elif char == "\t":
            out.append("\\t")
        elif ord(char) < 0x20:
            out.append(f"\\u{ord(char):04x}")
        else:
            out.append(char)
    out.append('"')
