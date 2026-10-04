class OrderService:
    # 6 real collaborators + self. The current rule counts self as one of the
    # 7, so it flags at 6 real dependencies instead of 7 - one early.
    def __init__(self, payments, inventory, shipping, notifications, pricing, audit):
        self.payments = payments
        self.inventory = inventory
        self.shipping = shipping
        self.notifications = notifications
        self.pricing = pricing
        self.audit = audit
