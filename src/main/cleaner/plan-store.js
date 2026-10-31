class PlanStore {
  constructor({ ttlMs = 10 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.plans = new Map();
  }

  set(planId, plan) {
    this.plans.set(planId, {
      ...plan,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs
    });
  }

  get(planId) {
    const plan = this.plans.get(planId);
    if (!plan) return null;
    if (Date.now() > plan.expiresAt) {
      this.plans.delete(planId);
      return null;
    }
    return plan;
  }

  consume(planId) {
    const plan = this.get(planId);
    if (plan) this.plans.delete(planId);
    return plan;
  }

  clearExpired() {
    const now = Date.now();
    for (const [planId, plan] of this.plans) {
      if (now > plan.expiresAt) this.plans.delete(planId);
    }
  }

  clear() {
    this.plans.clear();
  }
}

module.exports = {
  PlanStore
};
