"""仅修正读取时的 Windows 路径索引；保留原压缩包与 manifest 原件。"""
import json
from pathlib import Path
pack=Path('arc-task-ledger-pack').resolve()
entry=pack/'tools/pack_check.py'
namespace={'__file__':str(entry),'__name__':'arc_pack_compat'}
source=entry.read_text(encoding='utf-8').replace('str(p.relative_to(root))','p.relative_to(root).as_posix()')
exec(compile(source,str(entry),'exec'),namespace)
result=namespace['check'](pack)
print(json.dumps(result,ensure_ascii=False,indent=2))
raise SystemExit(0 if result['valid'] else 2)
