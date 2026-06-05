"""CDDA data pipeline — fetch, load, and resolve stages."""

from builder.fetch import CloneResult
from builder.load import LoadedData
from builder.resolve import ResolvedData

__all__ = ["CloneResult", "LoadedData", "ResolvedData"]
