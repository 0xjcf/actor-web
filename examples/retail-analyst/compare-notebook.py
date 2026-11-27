"""Run the user's actual Part II regex loop with measured, bounded live requests."""
import argparse
import ast
import contextlib
import importlib.util
import io
import json
import os
import time
from pathlib import Path
from types import SimpleNamespace

from dotenv import load_dotenv
from openai import OpenAI

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--notebook', type=Path, required=True)
parser.add_argument('--env-file', type=Path, required=True)
parser.add_argument('--model', default='gpt-4.1-mini')
args = parser.parse_args()
load_dotenv(args.env_file, override=False)
if not os.getenv('OPENAI_API_KEY'):
    raise SystemExit('OPENAI_API_KEY is missing; no request made.')
notebook = json.loads(args.notebook.read_text())
cells = [''.join(c.get('source', [])) for c in notebook['cells'] if c['cell_type'] == 'code']
lib_path = args.notebook.parent / 'lesson_2_lib.py'
spec = importlib.util.spec_from_file_location('comparison_lesson_lib', lib_path)
lib = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lib)
client = OpenAI(timeout=30, max_retries=0)
usage = {'inputTokens': 0, 'outputTokens': 0}
requests = []

def measured_create(**kwargs):
    response = client.chat.completions.create(**kwargs)
    message = response.choices[0].message
    requests.append(message.content or '')
    if response.usage:
        usage['inputTokens'] += response.usage.prompt_tokens
        usage['outputTokens'] += response.usage.completion_tokens
    return response

namespace = {
    'get_sales_data': lib.get_sales_data,
    'call_weather_api': lib.call_weather_api,
    'get_completion': lib.get_completion,
    'client': SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=measured_create))),
    'MODEL': args.model,
    'print_in_box': lambda *args, **kwargs: None,
}
# Load prompt literals only: skip Section 2's standalone model request.
prompt_cell = next(s for s in cells if 'react_system_prompt =' in s)
for node in ast.parse(prompt_cell).body:
    if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
        if node.targets[0].id in ('react_system_prompt', 'user_prompt_analyze'):
            namespace[node.targets[0].id] = ast.literal_eval(node.value)
started = time.perf_counter()
try:
    exec(next(s for s in cells if 'def calculator(' in s), namespace)
    exec(next(s for s in cells if 'def get_observation_message(' in s), namespace)
    loop = next(s for s in cells if "# Let's make the ReACT loop!" in s)
    if '**********' in loop:
        raise RuntimeError('Complete the notebook loop placeholders before comparison.')
    with contextlib.redirect_stdout(io.StringIO()):
        exec(compile(loop, str(args.notebook), 'exec'), namespace)
    action = requests[-1].split('ACT:', 1)[1].strip()
    call = ast.parse(action, mode='eval').body
    if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name) or call.func.id != 'final_answer':
        raise RuntimeError('Expected the final_answer action.')
    fields = {kw.arg: ast.literal_eval(kw.value) for kw in call.keywords}
    rows = sorted(lib.get_sales_data(products=['P005']), key=lambda row: row['date'])
    before, after = max(zip(rows, rows[1:]), key=lambda pair: (pair[1]['quantity'] - pair[0]['quantity']) / pair[0]['quantity'])
    result = {
        'date': fields['date'],
        'amount_before_increase': before['quantity'],
        'amount_after_increase': float(fields['amount_after_spike']),
        'percentage_increase': float(fields['percentage_spike'].rstrip('%')),
        'causes': fields['causes'],
    }
    assert result['date'] == str(after['date'])
    assert result['amount_after_increase'] == after['quantity']
    assert result['percentage_increase'] == round((after['quantity'] - before['quantity']) / before['quantity'] * 100, 2)
    print(json.dumps({
        'mode': 'live-notebook-regex', 'model': args.model, 'analysis': result,
        'modelCalls': len(requests), 'usage': usage,
        'durationMs': round((time.perf_counter() - started) * 1000),
        'actions': [text.split('ACT:', 1)[1].strip() if 'ACT:' in text else 'INVALID' for text in requests],
        'note': 'amount_before_increase is derived from the shared fixture; the notebook final_answer schema does not report it.',
    }, indent=2))
except Exception as error:
    # Never echo an SDK exception or request object containing credentials.
    print(json.dumps({'status': 'failed', 'modelCalls': len(requests), 'errorType': type(error).__name__}))
    raise SystemExit(1) from None
