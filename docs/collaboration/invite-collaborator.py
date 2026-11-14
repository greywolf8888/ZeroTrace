"""仅管理 greywolf8888/ZeroTrace 的仓库邀请；默认只检查，不保存凭据。"""
import argparse
import json
import re
import subprocess

REPO = "greywolf8888/ZeroTrace"
OWNER = "greywolf8888"

def api(method, path, body=None):
    if path != "user" and not path.startswith(("repos/" + REPO, "users/")):
        raise RuntimeError("拒绝访问目标仓库以外的管理接口")
    command = ["gh", "api", "--method", method, path]
    data = None
    if body is not None:
        command += ["--input", "-"]
        data = json.dumps(body)
    result = subprocess.run(command, input=data, text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError("GitHub 请求失败；检查所有者认证和仓库管理权限。未打印凭据。")
    return json.loads(result.stdout) if result.stdout.strip() else None

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--username", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?", args.username):
        parser.error("请提供 GitHub 用户名，不使用邮箱、URL 或命令文本")
    account = api("GET", "user")
    if account.get("login", "").casefold() != OWNER.casefold():
        raise RuntimeError("必须由仓库所有者自己的账号运行，不共享账号凭据")
    repo = api("GET", "repos/" + REPO)
    if repo.get("full_name", "").casefold() != REPO.casefold() or not repo.get("permissions", {}).get("admin"):
        raise RuntimeError("仓库身份或管理权限不匹配")
    user = api("GET", "users/" + args.username)
    username = user.get("login", "")
    if username.casefold() != args.username.casefold() or user.get("type") != "User":
        raise RuntimeError("GitHub 收件人身份不匹配")
    if username.casefold() == OWNER.casefold():
        raise RuntimeError("不能把所有者作为待邀请协作者")
    print(json.dumps({"repository": REPO, "recipient": username, "profile": user.get("html_url"),
                      "permission": "write", "apply": args.apply}, ensure_ascii=False))
    if not args.apply:
        print("仅检查，未发送邀请。核对对象后加 --apply。")
        return
    result = api("PUT", "repos/" + REPO + "/collaborators/" + username, {"permission": "push"})
    if result and result.get("id"):
        if result.get("repo", {}).get("full_name", "").casefold() != REPO.casefold():
            raise RuntimeError("邀请返回的仓库不匹配，需人工复核")
        print(json.dumps({"state": "PENDING_ACCEPTANCE", "invitationId": result["id"],
                          "repository": REPO, "recipient": username}, ensure_ascii=False))
    else:
        permission = api("GET", "repos/" + REPO + "/collaborators/" + username + "/permission")
        print(json.dumps({"state": "EXISTING_COLLABORATOR", "repository": REPO,
                          "permission": permission.get("permission"), "role": permission.get("role_name")},
                         ensure_ascii=False))

if __name__ == "__main__":
    main()
