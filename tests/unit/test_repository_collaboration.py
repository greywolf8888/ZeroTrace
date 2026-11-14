"""邀请管理的权限边界回归；所有替身仅在本测试目录。"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "docs/collaboration/invite-collaborator.py"
SPEC = importlib.util.spec_from_file_location("repository_collaboration", SCRIPT)
collaboration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collaboration)


class RepositoryCollaborationTests(unittest.TestCase):
    def invoke(self, apply=False, invitation=None):
        def respond(command, **kwargs):
            path = command[4]
            if path == "user":
                value = {"login": "greywolf8888"}
            elif path == "repos/greywolf8888/ZeroTrace":
                value = {"full_name": "greywolf8888/ZeroTrace", "permissions": {"admin": True}}
            elif path == "users/wangranorz":
                value = {"login": "wangranorz", "type": "User", "html_url": "https://github.com/wangranorz"}
            elif command[3] == "PUT":
                self.assertEqual(json.loads(kwargs["input"]), {"permission": "push"})
                value = invitation
            else:
                value = {"permission": "write", "role_name": "write"}
            return subprocess.CompletedProcess(command, 0, json.dumps(value), "")

        arguments = [str(SCRIPT), "--username", "wangranorz"] + (["--apply"] if apply else [])
        output = io.StringIO()
        with patch("sys.argv", arguments), patch.object(collaboration.subprocess, "run", side_effect=respond) as calls:
            with contextlib.redirect_stdout(output):
                collaboration.main()
        return output.getvalue(), calls

    def test_dry_run_never_sends_invitation(self):
        output, calls = self.invoke()
        self.assertIn("仅检查，未发送邀请", output)
        self.assertEqual([call.args[0][3] for call in calls.call_args_list], ["GET"] * 3)

    def test_real_github_response_shape_is_pending_not_effective(self):
        output, _ = self.invoke(True, {
            "id": 123,
            "repository": {"full_name": "greywolf8888/ZeroTrace"},
            "invitee": {"login": "wangranorz"},
            "permissions": "write",
        })
        self.assertIn("PENDING_ACCEPTANCE", output)
        self.assertNotIn("EXISTING_COLLABORATOR", output)

    def test_mismatched_response_fails_closed(self):
        expected = {"id": 123, "repository": {"full_name": "greywolf8888/ZeroTrace"},
                    "invitee": {"login": "wangranorz"}, "permissions": "write"}
        for field, value in [("repository", {"full_name": "greywolf8888/Other"}),
                             ("invitee", {"login": "someone-else"}), ("permissions", "admin")]:
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.invoke(True, {**expected, field: value})

    def test_paths_and_roles_cannot_expand_repository_scope(self):
        with patch.object(collaboration.subprocess, "run") as run:
            for method, path, body in [
                ("PUT", "repos/greywolf8888/Other/collaborators/wangranorz", {"permission": "push"}),
                ("PUT", "repos/greywolf8888/ZeroTrace-Other/collaborators/wangranorz", {"permission": "push"}),
                ("PUT", "repos/greywolf8888/ZeroTrace/collaborators/wangranorz", {"permission": "admin"}),
                ("DELETE", "repos/greywolf8888/ZeroTrace", None),
                ("PUT", "users/wangranorz", None),
            ]:
                with self.subTest(path=path, method=method), self.assertRaises(RuntimeError):
                    collaboration.api(method, path, body)
            run.assert_not_called()

    def test_existing_collaborator_is_checked(self):
        output, calls = self.invoke(True)
        self.assertIn('"permission": "write"', output)
        self.assertEqual(calls.call_args_list[-1].args[0][4],
                         "repos/greywolf8888/ZeroTrace/collaborators/wangranorz/permission")


if __name__ == "__main__":
    unittest.main()
