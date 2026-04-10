/* ===================================================
   FOODVISOR — Health Integration
   Uses @capgo/capacitor-health (Capacitor 8+)
   Unified API for Apple HealthKit & Google Health Connect
   Degrades gracefully when running in browser
   =================================================== */

const Health = {
  _available: null,
  _plugin: null,

  /** Check if health APIs are available (native platform with plugin) */
  async isAvailable() {
    if (this._available !== null) return this._available;

    try {
      if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        this._plugin = window.Capacitor.Plugins.Health
          || window.Capacitor.Plugins.CapacitorHealth || null;
        if (this._plugin) {
          const status = await this._plugin.isAvailable();
          this._available = status.available === true;
        } else {
          this._available = false;
        }
      } else {
        this._available = false;
      }
    } catch {
      this._available = false;
    }

    return this._available;
  },

  /** Get current platform: 'ios', 'android', or 'web' */
  getPlatform() {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
      return window.Capacitor.getPlatform();
    }
    return 'web';
  },

  /** Request authorization to read/write health data */
  async requestAuthorization() {
    if (!(await this.isAvailable())) return false;

    try {
      const result = await this._plugin.requestAuthorization({
        read: ['weight', 'height', 'steps', 'calories.active', 'heartRate'],
        write: ['weight', 'calories', 'steps'],
      });
      return result.authorized === true;
    } catch (err) {
      console.warn('Health authorization failed:', err);
      return false;
    }
  },

  /** Read the most recent weight (kg) */
  async getWeight() {
    if (!(await this.isAvailable())) return null;

    try {
      const now = new Date().toISOString();
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

      const result = await this._plugin.query({
        type: 'weight',
        startDate: monthAgo,
        endDate: now,
        limit: 1,
      });

      if (result?.data?.length > 0) {
        return Math.round(result.data[0].value * 10) / 10;
      }
    } catch (err) {
      console.warn('Failed to read weight:', err);
    }
    return null;
  },

  /** Read the most recent height (cm) */
  async getHeight() {
    if (!(await this.isAvailable())) return null;

    try {
      const now = new Date().toISOString();
      const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();

      const result = await this._plugin.query({
        type: 'height',
        startDate: yearAgo,
        endDate: now,
        limit: 1,
      });

      if (result?.data?.length > 0) {
        // Plugin returns height in meters, convert to cm
        const val = result.data[0].value;
        return val > 3 ? Math.round(val) : Math.round(val * 100);
      }
    } catch (err) {
      console.warn('Failed to read height:', err);
    }
    return null;
  },

  /** Read today's step count */
  async getTodaySteps() {
    if (!(await this.isAvailable())) return null;

    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

      const result = await this._plugin.queryAggregated({
        type: 'steps',
        startDate: startOfDay,
        endDate: now.toISOString(),
      });

      if (result?.value != null) {
        return Math.round(result.value);
      }
    } catch (err) {
      console.warn('Failed to read steps:', err);
    }
    return null;
  },

  /** Read the device owner's first name from Contacts */
  async getOwnerName() {
    try {
      if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return null;

      const contacts = window.Capacitor.Plugins.Contacts
        || window.Capacitor.Plugins.CapacitorContacts || null;
      if (!contacts) return null;

      // Request permission
      const perm = await contacts.requestPermissions();
      if (perm.contacts !== 'granted') return null;

      // Get contacts, look for "me" card or first contact
      const result = await contacts.getContacts({ projection: { name: true } });
      if (result?.contacts?.length > 0) {
        // Try to find the owner — usually the first contact or one marked as "me"
        const me = result.contacts.find(c => c.name?.given) || result.contacts[0];
        return me?.name?.given || null;
      }
    } catch (err) {
      console.warn('Failed to read owner name:', err);
    }
    return null;
  },

  /** Write a nutrition/calorie entry to Health (after saving a meal) */
  async writeNutrition({ calories, date }) {
    if (!(await this.isAvailable())) return false;
    if (!calories || calories <= 0) return false;

    try {
      await this._plugin.store({
        type: 'calories',
        value: calories,
        startDate: date || new Date().toISOString(),
        endDate: date || new Date().toISOString(),
      });
      return true;
    } catch (err) {
      console.warn('Failed to write nutrition:', err);
    }
    return false;
  },
};
