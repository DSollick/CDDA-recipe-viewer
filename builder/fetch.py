"""Sparse-clone acquisition of CDDA source data from GitHub."""

import dataclasses
import subprocess
import tempfile

REPO_URL = "https://github.com/CleverRaven/Cataclysm-DDA.git"

SPARSE_PATHS = [
    "data/json/",
    "data/mods/innawood/",
    "data/mods/",
]


@dataclasses.dataclass(frozen=True)
class CloneResult:
    path: str
    build_type: str   # "stable" | "experimental"
    tag: str | None   # e.g. "0.H" for stable, None for experimental
    commit_sha: str   # full 40-char SHA
    commit_date: str  # ISO-8601 UTC


def stable(dest: str | None = None) -> CloneResult:
    """Sparse-clone the latest stable CDDA tag into dest (or a fresh temp dir)."""
    if dest is None:
        dest = tempfile.mkdtemp(prefix="cdda_stable_")
    tag = _detect_latest_stable_tag(REPO_URL)
    _sparse_clone(REPO_URL, dest, SPARSE_PATHS, ref=tag)
    sha, date = _get_commit_info(dest)
    return CloneResult(path=dest, build_type="stable", tag=tag, commit_sha=sha, commit_date=date)


def experimental(dest: str | None = None) -> CloneResult:
    """Sparse-clone CDDA master HEAD into dest (or a fresh temp dir)."""
    if dest is None:
        dest = tempfile.mkdtemp(prefix="cdda_exp_")
    _sparse_clone(REPO_URL, dest, SPARSE_PATHS, ref="master")
    sha, date = _get_commit_info(dest)
    return CloneResult(path=dest, build_type="experimental", tag=None, commit_sha=sha, commit_date=date)


def _run(cmd: list[str], cwd: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            cmd,
            cwd=cwd,
            check=check,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as e:
        raise subprocess.CalledProcessError(
            e.returncode,
            e.cmd,
            output=e.output,
            stderr=e.stderr,
        ) from None


def _detect_latest_stable_tag(repo_url: str) -> str:
    """
    Query remote tags and return the highest version tag.

    Uses git's version sort, which handles CDDA's letter-based tags (0.H, 0.G, etc.)
    correctly. Filters out peeled (^{}) refs which are duplicates pointing at the
    underlying commit rather than the tag object.
    """
    result = _run([
        "git", "ls-remote", "--tags", "--sort=-version:refname", repo_url
    ])
    lines = result.stdout.strip().splitlines()
    for line in lines:
        parts = line.split()
        if len(parts) != 2:
            continue
        ref = parts[1]
        if ref.endswith("^{}"):
            continue
        if not ref.startswith("refs/tags/"):
            continue
        tag = ref.removeprefix("refs/tags/")
        if tag:
            return tag
    raise RuntimeError(f"No tags found in {repo_url}")


def _sparse_clone(repo_url: str, dest: str, paths: list[str], ref: str) -> None:
    _run(["git", "clone", "--filter=blob:none", "--sparse", "--no-checkout", repo_url, dest])
    _run(["git", "sparse-checkout", "set"] + paths, cwd=dest)
    _run(["git", "checkout", ref], cwd=dest)


def _get_commit_info(repo_dir: str) -> tuple[str, str]:
    result = _run(["git", "log", "-1", "--format=%H%n%cI"], cwd=repo_dir)
    sha, date = result.stdout.strip().splitlines()
    return sha.strip(), date.strip()
