/* ===================================================
   FOODVISOR — Health Integration
   Uses @capgo/capacitor-health (Capacitor 8+)
   API: isAvailable, requestAuthorization, readSamples,
        queryAggregated, saveSample
   Supported reads: weight, steps, calories, heartRate, distance
   =================================================== */

const Health = {
  _available: null,
  _plugin: null,

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

  getPlatform() {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
      return window.Capacitor.getPlatform();
    }
    return 'web';
  },

  async requestAuthorization() {
    if (!(await this.isAvailable())) return false;

    try {
      await this._plugin.requestAuthorization({
        read: ['weight', 'height', 'steps', 'calories.active', 'heartRate'],
        write: ['calories'],
      });
      return true;
    } catch (err) {
      console.warn('Health authorization failed:', err);
      return false;
    }
  },

  async getWeight() {
    if (!(await this.isAvailable())) return null;

    try {
      const now = new Date().toISOString();
      const ago = new Date(Date.now() - 90 * 86400000).toISOString();

      const result = await this._plugin.readSamples({
        dataType: 'weight',
        startDate: ago,
        endDate: now,
        limit: 1,
      });

      const samples = result?.samples || result?.data || [];
      if (samples.length > 0) {
        return Math.round(samples[0].value * 10) / 10;
      }
    } catch (err) {
      console.warn('Failed to read weight:', err);
    }
    return null;
  },

  async getTodaySteps() {
    if (!(await this.isAvailable())) return null;

    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

      const result = await this._plugin.queryAggregated({
        dataType: 'steps',
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

  async writeNutrition({ calories, date }) {
    if (!(await this.isAvailable())) return false;
    if (!calories || calories <= 0) return false;

    try {
      await this._plugin.saveSample({
        dataType: 'calories',
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

  /** Read owner's name and birthday from Contacts */
  async getOwnerInfo() {
    try {
      if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return null;

      const contacts = window.Capacitor.Plugins.Contacts
        || window.Capacitor.Plugins.CapacitorContacts || null;
      if (!contacts) return null;

      const perm = await contacts.requestPermissions();
      if (perm.contacts !== 'granted') return null;

      const result = await contacts.getContacts({
        projection: { name: true, birthday: true },
      });

      if (result?.contacts?.length > 0) {
        const me = result.contacts.find(c => c.name?.given) || result.contacts[0];
        const info = { name: me?.name?.given || me?.givenName || null };

        // Calculate age from birthday
        const bday = me?.birthday;
        if (bday?.year && bday?.month && bday?.day) {
          const today = new Date();
          let age = today.getFullYear() - bday.year;
          const monthDiff = today.getMonth() + 1 - bday.month;
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < bday.day)) {
            age--;
          }
          if (age > 0 && age < 120) info.age = age;
        }

        return info;
      }
    } catch (err) {
      console.warn('Failed to read owner info:', err);
    }
    return null;
  },
};
