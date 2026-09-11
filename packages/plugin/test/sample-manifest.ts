/**
 * A manifest for the fictional dispatch service used throughout the hub's
 * own tests. Unrelated to any real target, deliberately: the hub must not
 * acquire knowledge of whichever application it is first pointed at.
 */
export const sampleManifest = `
apiVersion: "1"
name: dispatch-service
description: notification dispatch service used by the hub's own tests

connections:
  primary-db:
    kind: postgres
    url: "{{env.DISPATCH_DB_URL}}"
  api:
    kind: http
    baseUrl: "{{env.DISPATCH_API_URL}}"
    headers:
      Accept: application/json
  ui:
    kind: browser
    baseUrl: "{{env.DISPATCH_UI_URL}}"

operations:
  OP-DISPATCH-SEND:
    executor: http
    connection: api
    method: POST
    path: /notifications
    params: [channel]
    body:
      channel: "{{param.channel}}"

  OP-COUNT-QUEUED:
    executor: sql
    connection: primary-db
    query: "select count(*) as n from queued_notifications"

  OP-DRAIN-QUEUE:
    executor: shell
    run: ["dispatchctl", "queue", "drain", "--yes"]
    timeoutMs: 30000

  OP-SEED-RECIPIENT:
    executor: shell
    run: ["python", "seeds/recipient.py"]
    stdin: json
    params: [email]

  OP-COUNT-RECIPIENTS:
    executor: sql
    connection: primary-db
    query: "select count(*) as n from recipients"

  OP-SIGN-IN:
    executor: browser
    connection: ui
    params: [email, password]
    steps:
      - { action: goto, url: "{{env.DISPATCH_UI_URL}}/sign-in" }
      - { action: fill, selector: "[data-testid=email]", value: "{{param.email}}" }
      - { action: fill, selector: "[data-testid=password]", value: "{{param.password}}" }
      - { action: click, selector: "[data-testid=submit]" }
      - { action: waitFor, selector: "[data-testid=dashboard]" }

  OP-TAIL-APP-LOG:
    executor: shell
    run: ["dispatchctl", "logs", "app", "--since", "{{param.since}}"]
    params: [since]

states:
  queue.empty:
    description: no notifications are waiting to be delivered
    ensure:
      operation: OP-DRAIN-QUEUE
    verify:
      operation: OP-COUNT-QUEUED
      assert: { kind: row_count, count: 0 }
    cost: low

  recipient.exists:
    ensure:
      operation: OP-SEED-RECIPIENT
      params: { email: sample@example.invalid }
    verify:
      operation: OP-COUNT-RECIPIENTS
      assert: { kind: row_count, count: 1 }
    cost: medium

evidence:
  app_log:
    operation: OP-TAIL-APP-LOG
    params: { since: "{{param.since}}" }
`;
