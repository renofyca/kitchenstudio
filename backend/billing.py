"""Billing stub — Stripe subscription integration (TODO for v2).

Planned:
  - Plans: e.g. "starter" (N projects), "pro" (unlimited projects,
    CSV catalog uploads), "team".
  - Checkout: Stripe Checkout Sessions created from the frontend's
    "Upgrade" button, redirecting back to /billing/success.
  - Webhook: POST /api/billing/webhook verifies the Stripe signature
    (stripe.Webhook.construct_event) and handles
    checkout.session.completed / customer.subscription.updated|deleted,
    persisting the subscription state per user.
  - Entitlements: a subscriptions table keyed by user_id consulted by
    the catalog/project routes to enforce plan limits.

No real logic yet — adding Stripe also means adding the `stripe` package
to backend/requirements.txt and STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
to the deployment environment.
"""

PLANS = {
    # "starter": {"price_id": "price_...", "projects": 3, "catalogs": 1},
    # "pro":     {"price_id": "price_...", "projects": -1, "catalogs": -1},
}


def get_subscription(user_id):
    """Return the user's subscription record, or None. TODO."""
    raise NotImplementedError("Stripe integration not implemented yet")


def create_checkout_session(user_id, plan):
    """Create a Stripe Checkout Session for plan. TODO."""
    raise NotImplementedError("Stripe integration not implemented yet")


def handle_webhook(payload, signature):
    """Verify + apply a Stripe webhook event. TODO."""
    raise NotImplementedError("Stripe integration not implemented yet")
