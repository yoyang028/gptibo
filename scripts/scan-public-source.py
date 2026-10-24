#!/usr/bin/env python3
"""Check tracked source (or an exported tree) without printing matched values.

This is a release guard for private artifacts and unexpected outbound hosts.
Run Gitleaks as well; neither check is a guarantee against all disclosures.
"""
import argparse
import ipaddress
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

PUBLIC_HOSTS = {
    'api.cloudflare.com', 'challenges.cloudflare.com', 'developers.cloudflare.com',
    'api.resend.com', 'api.telegram.org', 'open.feishu.cn', 't.me',
    'openapi.alipay.com', 'openapi-sandbox.dl.alipaydev.com', 'qr.alipay.com',
    'chatgpt.com', 'api.openai.com', 'help.openai.com', 'cdn.auth0.com',
    'github.com', 'raw.githubusercontent.com', 'registry.npmjs.org',
    'www.w3.org', 'www.apache.org', 'ui.shadcn.com', 'transitions.dev', 'vite.dev',
    'www.duolingo.com', 'www.duolingo.cn', 'd35aaqx5ub95lt.cloudfront.net',
    '98-xj.com',  # Reviewed public Xiaojiu upstream API and documentation.
    '982xj.xyz',  # Redemption origin linked by the matched Xiaojiu products.
    'claude.com', 'support.claude.com',  # Official plan explanations, not supplier guarantees.
    'ai.hanfolk.xyz',  # Existing reviewed reseller catalog integration.
    'grizzlysms.com', 'api.grizzlysms.com',  # Reviewed public Grizzly SMS API.
}
PUBLIC_DOC_REFERENCES = {
    # Existing public reference links are permitted only in their documentation;
    # this does not permit application requests to these shop-specific origins.
    'public/brands/README.md': {
        'muse.gptibo.com', 'grok.com', 'www.gstatic.com', 'www.adobe.com',
        'account.apple.com', 'appleid.cdn-apple.com', 'music.apple.com', 'www.capcut.com',
        'workspace.google.com', 'cursor.com',  # Reviewed official artwork references.
    },
    'docs/GRIZZLY_SMS.md': {'shop.scholai.top'},
    'docs/GROK_XIAOJIU.md': {'x.ai', 'docs.x.ai', 'help.x.com'},
    'docs/HANFOLK_BUYER_DETAILS.md': {
        'vip.dajuai.us', 'owlduo.com', 'muse.ai', 'grok.com',
        'gemini.google.com', 'accounts.google.com', 'express.adobe.com',
        'www.capcut.com', 'www.jio.com',
    },
    'docs/MUSE_PRODUCTS.md': {'muse.dajuxai.com', 'muse.ai'},
    'docs/APPLE_ID_PRODUCTS.md': {'account.apple.com', 'iforgot.apple.com', 'support.apple.com'},
    'public/guides/muse-change-email/README.md': {'muse.dajuxai.com'},
}
# Verified buyer-facing links, scoped to editorial copy and its tests. They do
# not expand the API client's allowlist or authorize backend requests.
PUBLIC_BUYER_REFERENCES = {
    'shared/hanfolk-buyer-copy.ts': {
        'vip.dajuai.us', 'owlduo.com', 'muse.ai', 'grok.com',
        'gemini.google.com', 'accounts.google.com', 'express.adobe.com',
        'www.capcut.com', 'www.jio.com',
    },
    'shared/muse-buyer-copy.ts': {'muse.ai'},
    'shared/apple-id-buyer-copy.ts': {'account.apple.com'},
    'src/components/apple-id-guide-page.tsx': {'account.apple.com', 'iforgot.apple.com', 'support.apple.com'},
    'tests/hanfolk-buyer-copy.test.ts': {'vip.dajuai.us', 'owlduo.com', 'grok.com'},
}
BINARY_ASSETS = {'public/email-logo.png', 'public/email-shop.png', 'src/assets/hero.png'}
MUSE_GUIDE_IMAGES = {f'public/guides/muse-change-email/{i:02d}.jpg' for i in range(1, 16)}
APPLE_GUIDE_PNG = {'public/guides/apple-id/01.png'}
APPLE_GUIDE_JPEG = {f'public/guides/apple-id/{i:02d}.jpg' for i in range(2, 12)}
FORBIDDEN_PARTS = {'.git', '.secrets', '.imports', '.admin-auth', '.xgift-private',
                   'node_modules', 'dist', '.preview', '.wrangler', 'artifacts', '__pycache__'}
FORBIDDEN_SUFFIXES = {'.pem', '.key', '.p12', '.pfx', '.sqlite', '.db', '.dump',
                      '.backup', '.har', '.log', '.zip', '.gz', '.exe'}
SECRET = re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/]{20}')
TOKEN = re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{30,})\b')
URL = re.compile(r'https?://[A-Za-z0-9_.:@/-]+')
CLOUD_ID = re.compile(r'"(?:account_id|zone_id|database_id)"\s*:\s*"([a-fA-F0-9-]+)"')


def allowed_host(host):
    host = host.lower()
    if host in PUBLIC_HOSTS or host in {'localhost', '127.0.0.1', '0.0.0.0', '::1', 'example.com', 'example.org', 'example.net'}:
        return True
    if host.endswith(('.example.com', '.example.org', '.example.net', '.example', '.test', '.invalid')):
        return True
    # Explicit test fixtures for public authentication infrastructure.
    if host == 'team.cloudflareaccess.com':
        return True
    try:
        return not ipaddress.ip_address(host).is_global
    except ValueError:
        return False


def scan(root, files):
    findings = []
    for name in sorted(files):
        path = root / name
        if path.is_symlink():
            findings.append((name, 0, 'symlink forbidden in public export'))
            continue
        if not path.exists():
            continue  # Deleted tracked file in a preparation branch.
        if not path.is_file():
            continue
        parts = Path(name).parts
        if (FORBIDDEN_PARTS.intersection(parts) or path.suffix in FORBIDDEN_SUFFIXES
                or (path.name.startswith('.env') and not path.name.endswith('.example'))
                or (path.name.startswith('.dev.vars') and not path.name.endswith('.example'))
                or name.startswith(('services/platform/', 'services/xgift/'))):
            findings.append((name, 0, 'private/runtime artifact'))
            continue
        data = path.read_bytes()
        try:
            source = data.decode('utf-8')
        except UnicodeDecodeError:
            if not ((name in (BINARY_ASSETS | APPLE_GUIDE_PNG) and data.startswith(b'\x89PNG\r\n\x1a\n'))
                    or (name in (MUSE_GUIDE_IMAGES | APPLE_GUIDE_JPEG) and data.startswith(b'\xff\xd8\xff'))):
                findings.append((name, 0, 'unreviewed binary asset'))
            continue
        for rule, pattern in [('private key', SECRET), ('credential token', TOKEN)]:
            for match in pattern.finditer(source):
                findings.append((name, source.count('\n', 0, match.start()) + 1, rule))
        for match in CLOUD_ID.finditer(source):
            if set(match.group(1)) - {'0', '-'}:
                findings.append((name, source.count('\n', 0, match.start()) + 1, 'non-placeholder cloud resource ID'))
        if path.name == 'package-lock.json':
            continue  # Dependency integrity is checked by npm ci and Gitleaks.
        for line, text in enumerate(source.splitlines(), 1):
            for match in URL.finditer(text):
                try:
                    host = urlsplit(match.group()).hostname or ''
                except ValueError:
                    findings.append((name, line, 'malformed URL requires review'))
                    continue
                # Ignore templates and incomplete expression/regex fragments.
                if '.' not in host or host.endswith('.'):
                    continue
                if (not allowed_host(host)
                        and host not in PUBLIC_DOC_REFERENCES.get(name, set())
                        and host not in PUBLIC_BUYER_REFERENCES.get(name, set())):
                    findings.append((name, line, 'unexpected external host'))
    return sorted(set(findings))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tree', type=Path, help='scan an exported source directory, including hidden files')
    args = parser.parse_args()
    if args.tree:
        root = args.tree.resolve()
        files = [p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() or p.is_symlink()]
    else:
        root = Path(__file__).resolve().parents[1]
        files = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=root).decode().split('\0')
        files = [name for name in files if name]
    findings = scan(root, files)
    for name, line, rule in findings:
        print(f'{name}:{line}: {rule}')
    print(f'Public-source scan: {len(files)} paths checked, {len(findings)} findings. Values are never printed.')
    return bool(findings)


if __name__ == '__main__':
    sys.exit(main())
