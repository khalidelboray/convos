/**
 * Reactive is a class that can be useful for objects that you want to observe.
 * It also contains some helper methods to define properties.
 *
 * @exports Reactive
 * @class Reactive
 * @see Dialog
 * @see EmbedMaker
 * @see Events
 * @see Operation
 * @see User
 */

import Cookies from 'js-cookie';
import {isType} from '../js/util';

export default class Reactive {
  constructor() {
    this.cookieName = 'convos_js';
    this._on = {};
    this._props = {};
  }

  /**
   * emit() is used to notify listeners about a change.
   *
   * @memberof Reactive
   * @param {String} event The name of the event to emit.
   * @param {Any} params Any data that will be passed on to the listeners.
   */
  emit(event, ...params) {
    const subscribers = this._on[event];
    for (let i = 0; i < (subscribers || []).length; i++) subscribers[i][0](...params);
    return this;
  }

  /**
   * on() is used by listeners to listen for an event to be emitted.
   *
   * @memberof Reactive
   * @param {String} event The name of the event to listen to.
   * @param {Function} cb A function to be called when an event is emitted.
   */
  on(event, cb) {
    const p = cb ? null : new Promise(resolve => { cb = resolve });
    const subscribers = this._on[event] || (this._on[event] = []);
    const subscriber = [cb]; // Make sure each element is unique
    subscribers.push(subscriber);

    const unsubscribe = () => {
      const index = subscribers.indexOf(subscriber);
      if (index != -1) subscribers.splice(index, 1);
    };

    return p ? p.finally(unsubscribe) : unsubscribe;
  }

  /**
   * prop() can be used to define a new property.
   *
   * The following types are allowed:
   *
   * 1. "persist" is a property that will be stored in the browser's localStorage.
   *    It can be changed by calling update().
   * 2. "ro" is a property that cannot be changed.
   * 3. "rw" is a property that can be changed by the "update()" method.
   *
   * The code below cannot be used to update any prop() property. A change must
   * go through update().
   *
   *     this.some_property = 'new value';
   *
   * @memberof Reactive
   * @param {String} type either "cookie", "persist", "ro" or "rw".
   * @param {String} name The name of the property
   * @param {Any} value Either a function or default value.
   * @param {Object} params Extra property instructions.
   */
  prop(type, name, value, params = {}) {
    const prop = {...params, name, type, value};
    this._props[name] = prop; // this._props must not be set anywhere else!

    prop.updateable = ['cookie', 'persist', 'rw'].indexOf(type) != -1;

    switch (type) {
      case 'cookie': return this._cookieProp(prop);
      case 'persist': return this._localStorageProp(prop);
      case 'ro': return this._readOnlyProp(prop);
      case 'rw': return this._updateableProp(prop);
    }

    throw '[' + this.constructor.name + '] Unknown prop type "' + type + '" for prop "' + name + '".';
  }

  /**
   * subscribe() is a special case of `on()` to listen for "update" events.
   * This method exists because it is used by
   * [Svelte stores](https://svelte.dev/docs#svelte_store).
   *
   * The function passed to this method will also be called right away, with
   * the current object as parameter.
   *
   * @memberof Reactive
   * @param {Function} cb A function to be called when the "update" event is emitted.
   */
  subscribe(cb) {
    cb(this);
    return this.on('update', cb);
  }

  /**
   * update() can be used to change the properties defined by prop(). This
   * method will asynchronously emit the "update" event once all properties
   * have been updated.
   *
   * Any key in "params" that does not map to a defined prop() will be ignored.
   *
   * @memberof Reactive
   * @param {Object} params A map between property name and value.
   */
  update(params) {
    Object.keys(params).forEach(name => {
      const prop = this._props[name];
      if (!prop) return; // console.log('[' + this.constructor.name + '] Unknown prop "' + name + '".');
      if (!prop.hasOwnProperty('prev')) prop.prev = prop.type == 'ro' ? undefined : prop.value;
      if (prop.updateable) prop.value = params[name];
    });

    if (!this._updatedTid) this._updatedTid = setTimeout(this._delayedUpdate.bind(this), 1);
    return this;
  }

  _cookie(name, value) {
    const store = document.decodedB64JSONCookies || (document.decodedB64JSONCookies = {});

    if (!store[this.cookieName]) {
      try {
        const cookieString = Cookies.get(this.cookieName);
        store[this.cookieName] = JSON.parse(cookieString ? atob(cookieString) : '{}');
      } catch(err) {
        console.error('[Reactive:cookie]', {[name]: err});
      }
    }

    const cookie = store[this.cookieName] || {};
    if (arguments.length == 1) return cookie[name];

    cookie[name] = value;
    const secure = location.href.indexOf('https:') == 0;
    Cookies.set(this.cookieName, btoa(JSON.stringify(cookie)), {expires: 365, SameSite: 'Lax', secure});
  }

  _cookieProp(prop) {
    const fromStorage = this._cookie(prop.name);
    if (!isType(fromStorage, 'undef')) prop.value = fromStorage;
    if (isType(fromStorage, 'undef') && !prop.lazy) this._cookie(prop.name, prop.value);
    this._updateableProp(prop);
  }

  _delayedUpdate() {
    const changed = {};
    Object.keys(this._props).forEach(name => {
      const prop = this._props[name];
      if (!prop.hasOwnProperty('prev')) return;
      const prev = prop.prev;
      delete prop.prev;
      if (prop.value === prev) return;
      if (prop.type == 'cookie') this._cookie(name, prop.value);
      if (prop.type == 'persist') this._localStorage(name, prop.value);
      changed[name] = prop.type != 'ro';
    });

    delete this._updatedTid;
    if (Object.keys(changed).length) this.emit('update', this, changed);
    return changed; // Used by unit test
  }

  _localStorage(name, value) {
    const key = 'convos:' + (this._props[name].key || name);
    if (arguments.length == 2) return localStorage.setItem(key, JSON.stringify(value));

    try {
      return localStorage.hasOwnProperty(key) ? JSON.parse(localStorage.getItem(key)) : undefined;
    } catch(err) {
      console.error('[Reactive:localStorage]', {[key]: localStorage.getItem(key)}, err);
      return undefined;
    }
  }

  _localStorageProp(prop) {
    const fromStorage = this._localStorage(prop.name);
    if (!isType(fromStorage, 'undef')) prop.value = fromStorage;
    if (isType(fromStorage, 'undef') && !prop.lazy) this._localStorage(prop.name, prop.value);
    this._updateableProp(prop);
  }

  _readOnlyProp(prop) {
    if (prop.value === undefined) throw '[' + this.constructor.name + '] Read-only attribute "' + prop.name + '" cannot be undefined';
    const get = typeof prop.value == 'function' ? prop.value : () => prop.value;
    Object.defineProperty(this, prop.name, {get});
  }

  _updateableProp(prop) {
    Object.defineProperty(this, prop.name, {get: () => prop.value});
  }
}
