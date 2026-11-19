#!/usr/bin/env python3
"""Cria no Zendesk um webhook para o Google Chat e um trigger que replica as
condições de uma view, avisando o espaço do Chat a cada ticket novo.

Variáveis de ambiente:
  ZENDESK_SUBDOMAIN   ex.: minhaempresa (de minhaempresa.zendesk.com)
  ZENDESK_EMAIL       e-mail de um admin do Zendesk
  ZENDESK_API_TOKEN   token de API (Admin Center > Apps e integrações > API do Zendesk)
  GCHAT_WEBHOOK_URL   URL do webhook de entrada do espaço do Google Chat

Uso:
  python3 setup_view_alert.py list-views
  python3 setup_view_alert.py test-chat
  python3 setup_view_alert.py create <view_id> [--dry-run]
"""
import base64
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error

MESSAGE_TEMPLATE = {
    "text": (
        "🎫 *Novo ticket #{{ticket.id}}* (view: %s)\n"
        "*Assunto:* {{ticket.title}}\n"
        "*Grupo:* {{ticket.group.name}}\n"
        "*Prioridade:* {{ticket.priority}}\n"
        "*Solicitante:* {{ticket.requester.name}}\n"
        "<{{ticket.link}}|Abrir no Zendesk>"
    ),
    "thread": {"threadKey": "zendesk-{{ticket.id}}"},
}


def env(name):
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Variável de ambiente {name} não definida.")
    return value


def zendesk(method, path, body=None):
    base = f"https://{env('ZENDESK_SUBDOMAIN')}.zendesk.com/api/v2"
    creds = f"{env('ZENDESK_EMAIL')}/token:{env('ZENDESK_API_TOKEN')}"
    req = urllib.request.Request(
        base + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": "Basic " + base64.b64encode(creds.encode()).decode(),
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"Zendesk {method} {path} -> {e.code}: {e.read().decode()[:500]}")


def chat_url():
    url = env("GCHAT_WEBHOOK_URL")
    if "messageReplyOption" not in url:
        url += "&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"
    return url


def list_views():
    data = zendesk("GET", "/views/active.json")
    for v in data.get("views", []):
        print(f"{v['id']:>15}  {v['title']}")


def test_chat():
    req = urllib.request.Request(
        chat_url(),
        method="POST",
        data=json.dumps({"text": "✅ Teste de conexão Zendesk → Google Chat"}).encode(),
        headers={"Content-Type": "application/json; charset=UTF-8"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        print("Google Chat respondeu", resp.status)


def find_or_create_webhook(dry_run):
    name = "Google Chat - alertas de views"
    existing = zendesk("GET", "/webhooks?filter[name_contains]=" + urllib.parse.quote(name))
    for wh in existing.get("webhooks", []):
        if wh["name"] == name:
            print(f"Webhook já existe: {wh['id']}")
            return wh["id"]
    payload = {
        "webhook": {
            "name": name,
            "endpoint": chat_url(),
            "http_method": "POST",
            "request_format": "json",
            "status": "active",
            "subscriptions": ["conditional_ticket_events"],
        }
    }
    if dry_run:
        print("[dry-run] criaria webhook:", json.dumps(payload, indent=2, ensure_ascii=False))
        return "WEBHOOK_ID"
    wh = zendesk("POST", "/webhooks", payload)["webhook"]
    print(f"Webhook criado: {wh['id']}")
    return wh["id"]


def create(view_id, dry_run):
    view = zendesk("GET", f"/views/{view_id}.json")["view"]
    conditions = view.get("conditions", {"all": [], "any": []})
    all_conds = [c for c in conditions.get("all", []) if c.get("field") != "update_type"]
    all_conds.insert(0, {"field": "update_type", "operator": "is", "value": "Create"})

    webhook_id = find_or_create_webhook(dry_run)
    body = dict(MESSAGE_TEMPLATE)
    body["text"] = MESSAGE_TEMPLATE["text"] % view["title"]

    payload = {
        "trigger": {
            "title": f"[Google Chat] Novo ticket na view: {view['title']}",
            "active": True,
            "conditions": {"all": all_conds, "any": conditions.get("any", [])},
            "actions": [
                {"field": "notification_webhook", "value": [webhook_id, json.dumps(body, ensure_ascii=False)]}
            ],
        }
    }
    if dry_run:
        print("[dry-run] criaria trigger:", json.dumps(payload, indent=2, ensure_ascii=False))
        return
    trig = zendesk("POST", "/triggers.json", payload)["trigger"]
    print(f"Trigger criado: {trig['id']} — {trig['title']}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    if args[0] == "list-views":
        list_views()
    elif args[0] == "test-chat":
        test_chat()
    elif args[0] == "create" and len(args) >= 2:
        create(args[1], "--dry-run" in args)
    else:
        sys.exit(__doc__)
