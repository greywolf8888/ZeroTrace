"""从固定 Git 提交生成 ZeroTrace 协作文档包；不读取工作区私有配置。"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "AGENTS.md", "README.md", "PROGRESS.md", "CONTRIBUTING.md", "SECURITY.md", "LICENSE",
    ".env.example", "docker-compose.yml", "docs/HANDOFF.zh-CN.md", "docs/activities/ARC.md",
    "docs/architecture/ARCHITECTURE.md", "docs/architecture/ZEROTRACE_MASTER_PROMPT.md",
    "docs/DEVELOPMENT.md", "docs/DEPLOYMENT.md", "docs/API.md",
    "docs/testing/FINAL_ACCEPTANCE.md", "docs/terminal-market-structure/当前上下文.md",
    "docs/terminal-market-structure/未验证边界.md", "docs/terminal-market-structure/执行状态.json",
    "docs/terminal-market-structure/续接交付_20261114.md", "docs/product-closure/当前上下文.md",
    "docs/collaboration/README.zh-CN.md", "docs/collaboration/access-plan.json",
    "docs/collaboration/branch-plan.json", "docs/collaboration/branch-protection.proposed.json",
    "docs/collaboration/EXECUTION_20261114.json", "docs/collaboration/invite-collaborator.py",
    "docs/collaboration/CONSOLIDATION_RECEIPT_20261114.json",
    "docs/research/THIRD_PARTY_DEPENDENCIES.md", "infra/minio/Dockerfile", "infra/minio/README.zh-CN.md",
    "tests/unit/test_repository_collaboration.py", "scripts/build-collaboration-pack.py",
    "docs/terminal-market-structure/视觉基线_20261114.json", "docs/terminal-market-structure/视觉基线入口.json",
    "docs/terminal-market-structure/validation/continuation-20261114/SUMMARY.json",
    "docs/terminal-market-structure/validation/continuation-20261114/visual-capture-r4.json",
)


def git(*arguments):
    return subprocess.check_output(["git", "-C", str(ROOT), *arguments])


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default="HEAD", help="固定来源提交，默认 HEAD")
    parser.add_argument("--output", type=Path, required=True, help="新 ZIP 路径，不覆盖已有文件")
    args = parser.parse_args()
    commit = git("rev-parse", "--verify", "--end-of-options", args.ref + "^{commit}").decode().strip()
    output = args.output.resolve()
    receipt_path = output.with_suffix(".receipt.json")
    if output.exists() or receipt_path.exists():
        parser.error("输出或收据已存在；请使用新文件名，保留旧包。")
    payloads = {path: git("show", commit + ":" + path) for path in FILES}
    access = json.loads(payloads["docs/collaboration/access-plan.json"])
    start = (
        "# ZeroTrace 协作交接包\n\n"
        "请先读 docs/HANDOFF.zh-CN.md 和 docs/collaboration/README.zh-CN.md。\n\n"
        f"资料来源为固定提交 `{commit}`，从实际 main 建立的短期续接候选；不表示已合并或终端验收通过。"
        "项目只有 main 一条长期主线，Arc/BundleMark 为活动支线。\n\n"
        "本包按显式清单读取 Git 对象；没有读取本机 .env、数据库、原始证据库、所有者 Token、SSH 私钥或会话。"
        "协作者应使用自己的 GitHub 登录克隆 greywolf8888/ZeroTrace；接受邀请后自行核对 Write 是否生效。\n\n"
        f"协作对象：{access['recipient']}；快照邀请状态：{access['invitationStatus']}。"
        "状态会变化，固定文档不能代替在线权限。公开仓库和活动分支可读；邀请不授予其他仓库写权限。\n\n"
        "所有文件的字节数和 SHA-256 位于 PACK_MANIFEST.json，可通过固定提交重新生成核对。"
        "执行记录中的历史 PASS 只属于原 SHA；真实链、外部身份、正式取证和发行门禁按现有账本保留。\n"
    ).encode("utf-8")
    payloads["00_开始阅读.md"] = start
    manifest = {
        "schemaVersion": "zerotrace-collaboration-pack-v4",
        "sourceSnapshot": commit,
        "repository": "greywolf8888/ZeroTrace",
        "sourceBranch": "agent/terminal-market-structure-v1",
        "mainBaseline": "a931eec96890dc3072f285f10f965251039943b4",
        "invitationStateAtSnapshot": access["invitationStatus"],
        "ownerCredentialsIncluded": False,
        "files": [{"path": path, "bytes": len(payload), "sha256": digest(payload)}
                  for path, payload in sorted(payloads.items())],
    }
    payloads["PACK_MANIFEST.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    prefix = output.stem + "/"
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "x", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for path, payload in sorted(payloads.items()):
            info = ZipInfo(prefix + path, date_time=(2026, 11, 14, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, payload)
    with ZipFile(output) as archive:
        if archive.testzip() is not None or len(archive.namelist()) != len(payloads):
            raise RuntimeError("ZIP CRC 或条目数量检查失败")
        for path, payload in payloads.items():
            if archive.read(prefix + path) != payload:
                raise RuntimeError("ZIP 内容与来源不一致：" + path)
    receipt = {
        "schemaVersion": "zerotrace-collaboration-pack-receipt-v4",
        "sourceSnapshot": commit,
        "package": output.name,
        "bytes": output.stat().st_size,
        "sha256": digest(output.read_bytes()),
        "entries": len(payloads),
        "manifestSha256": digest(payloads["PACK_MANIFEST.json"]),
        "checks": {"crc32": "PASS", "allEntryBytes": "PASS", "unicodePaths": "PASS",
                   "fixedGitObjects": "PASS", "privateWorkspaceFilesRead": False},
        "invitationStateAtSnapshot": access["invitationStatus"],
        "fullProductGates": "NOT_PROMOTED",
    }
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(receipt, ensure_ascii=False))


if __name__ == "__main__":
    main()
