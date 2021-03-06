/**
 * @module ol/MapBrowserEventHandler
 */
import {inherits} from './index.js';
import _ol_has_ from './has.js';
import MapBrowserEventType from './MapBrowserEventType.js';
import MapBrowserPointerEvent from './MapBrowserPointerEvent.js';
import _ol_events_ from './events.js';
import EventTarget from './events/EventTarget.js';
import PointerEventType from './pointer/EventType.js';
import _ol_pointer_PointerEventHandler_ from './pointer/PointerEventHandler.js';

/**
 * @param {ol.PluggableMap} map The map with the viewport to listen to events on.
 * @param {number|undefined} moveTolerance The minimal distance the pointer must travel to trigger a move.
 * @constructor
 * @extends {ol.events.EventTarget}
 */
var MapBrowserEventHandler = function(map, moveTolerance) {

  EventTarget.call(this);

  /**
   * This is the element that we will listen to the real events on.
   * @type {ol.PluggableMap}
   * @private
   */
  this.map_ = map;

  /**
   * @type {number}
   * @private
   */
  this.clickTimeoutId_ = 0;

  /**
   * @type {boolean}
   * @private
   */
  this.dragging_ = false;

  /**
   * @type {!Array.<ol.EventsKey>}
   * @private
   */
  this.dragListenerKeys_ = [];

  /**
   * @type {number}
   * @private
   */
  this.moveTolerance_ = moveTolerance ?
    moveTolerance * _ol_has_.DEVICE_PIXEL_RATIO : _ol_has_.DEVICE_PIXEL_RATIO;

  /**
   * The most recent "down" type event (or null if none have occurred).
   * Set on pointerdown.
   * @type {ol.pointer.PointerEvent}
   * @private
   */
  this.down_ = null;

  var element = this.map_.getViewport();

  /**
   * @type {number}
   * @private
   */
  this.activePointers_ = 0;

  /**
   * @type {!Object.<number, boolean>}
   * @private
   */
  this.trackedTouches_ = {};

  /**
   * Event handler which generates pointer events for
   * the viewport element.
   *
   * @type {ol.pointer.PointerEventHandler}
   * @private
   */
  this.pointerEventHandler_ = new _ol_pointer_PointerEventHandler_(element);

  /**
   * Event handler which generates pointer events for
   * the document (used when dragging).
   *
   * @type {ol.pointer.PointerEventHandler}
   * @private
   */
  this.documentPointerEventHandler_ = null;

  /**
   * @type {?ol.EventsKey}
   * @private
   */
  this.pointerdownListenerKey_ = _ol_events_.listen(this.pointerEventHandler_,
      PointerEventType.POINTERDOWN,
      this.handlePointerDown_, this);

  /**
   * @type {?ol.EventsKey}
   * @private
   */
  this.relayedListenerKey_ = _ol_events_.listen(this.pointerEventHandler_,
      PointerEventType.POINTERMOVE,
      this.relayEvent_, this);

};

inherits(MapBrowserEventHandler, EventTarget);


/**
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @private
 */
MapBrowserEventHandler.prototype.emulateClick_ = function(pointerEvent) {
  var newEvent = new MapBrowserPointerEvent(
      MapBrowserEventType.CLICK, this.map_, pointerEvent);
  this.dispatchEvent(newEvent);
  if (this.clickTimeoutId_ !== 0) {
    // double-click
    clearTimeout(this.clickTimeoutId_);
    this.clickTimeoutId_ = 0;
    newEvent = new MapBrowserPointerEvent(
        MapBrowserEventType.DBLCLICK, this.map_, pointerEvent);
    this.dispatchEvent(newEvent);
  } else {
    // click
    this.clickTimeoutId_ = setTimeout(function() {
      this.clickTimeoutId_ = 0;
      var newEvent = new MapBrowserPointerEvent(
          MapBrowserEventType.SINGLECLICK, this.map_, pointerEvent);
      this.dispatchEvent(newEvent);
    }.bind(this), 250);
  }
};


/**
 * Keeps track on how many pointers are currently active.
 *
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @private
 */
MapBrowserEventHandler.prototype.updateActivePointers_ = function(pointerEvent) {
  var event = pointerEvent;

  if (event.type == MapBrowserEventType.POINTERUP ||
      event.type == MapBrowserEventType.POINTERCANCEL) {
    delete this.trackedTouches_[event.pointerId];
  } else if (event.type == MapBrowserEventType.POINTERDOWN) {
    this.trackedTouches_[event.pointerId] = true;
  }
  this.activePointers_ = Object.keys(this.trackedTouches_).length;
};


/**
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @private
 */
MapBrowserEventHandler.prototype.handlePointerUp_ = function(pointerEvent) {
  this.updateActivePointers_(pointerEvent);
  var newEvent = new MapBrowserPointerEvent(
      MapBrowserEventType.POINTERUP, this.map_, pointerEvent);
  this.dispatchEvent(newEvent);

  // We emulate click events on left mouse button click, touch contact, and pen
  // contact. isMouseActionButton returns true in these cases (evt.button is set
  // to 0).
  // See http://www.w3.org/TR/pointerevents/#button-states
  // We only fire click, singleclick, and doubleclick if nobody has called
  // event.stopPropagation() or event.preventDefault().
  if (!newEvent.propagationStopped && !this.dragging_ && this.isMouseActionButton_(pointerEvent)) {
    this.emulateClick_(this.down_);
  }

  if (this.activePointers_ === 0) {
    this.dragListenerKeys_.forEach(_ol_events_.unlistenByKey);
    this.dragListenerKeys_.length = 0;
    this.dragging_ = false;
    this.down_ = null;
    this.documentPointerEventHandler_.dispose();
    this.documentPointerEventHandler_ = null;
  }
};


/**
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @return {boolean} If the left mouse button was pressed.
 * @private
 */
MapBrowserEventHandler.prototype.isMouseActionButton_ = function(pointerEvent) {
  return pointerEvent.button === 0;
};


/**
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @private
 */
MapBrowserEventHandler.prototype.handlePointerDown_ = function(pointerEvent) {
  this.updateActivePointers_(pointerEvent);
  var newEvent = new MapBrowserPointerEvent(
      MapBrowserEventType.POINTERDOWN, this.map_, pointerEvent);
  this.dispatchEvent(newEvent);

  this.down_ = pointerEvent;

  if (this.dragListenerKeys_.length === 0) {
    /* Set up a pointer event handler on the `document`,
     * which is required when the pointer is moved outside
     * the viewport when dragging.
     */
    this.documentPointerEventHandler_ =
        new _ol_pointer_PointerEventHandler_(document);

    this.dragListenerKeys_.push(
        _ol_events_.listen(this.documentPointerEventHandler_,
            MapBrowserEventType.POINTERMOVE,
            this.handlePointerMove_, this),
        _ol_events_.listen(this.documentPointerEventHandler_,
            MapBrowserEventType.POINTERUP,
            this.handlePointerUp_, this),
        /* Note that the listener for `pointercancel is set up on
       * `pointerEventHandler_` and not `documentPointerEventHandler_` like
       * the `pointerup` and `pointermove` listeners.
       *
       * The reason for this is the following: `TouchSource.vacuumTouches_()`
       * issues `pointercancel` events, when there was no `touchend` for a
       * `touchstart`. Now, let's say a first `touchstart` is registered on
       * `pointerEventHandler_`. The `documentPointerEventHandler_` is set up.
       * But `documentPointerEventHandler_` doesn't know about the first
       * `touchstart`. If there is no `touchend` for the `touchstart`, we can
       * only receive a `touchcancel` from `pointerEventHandler_`, because it is
       * only registered there.
       */
        _ol_events_.listen(this.pointerEventHandler_,
            MapBrowserEventType.POINTERCANCEL,
            this.handlePointerUp_, this)
    );
  }
};


/**
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @private
 */
MapBrowserEventHandler.prototype.handlePointerMove_ = function(pointerEvent) {
  // Between pointerdown and pointerup, pointermove events are triggered.
  // To avoid a 'false' touchmove event to be dispatched, we test if the pointer
  // moved a significant distance.
  if (this.isMoving_(pointerEvent)) {
    this.dragging_ = true;
    var newEvent = new MapBrowserPointerEvent(
        MapBrowserEventType.POINTERDRAG, this.map_, pointerEvent,
        this.dragging_);
    this.dispatchEvent(newEvent);
  }

  // Some native android browser triggers mousemove events during small period
  // of time. See: https://code.google.com/p/android/issues/detail?id=5491 or
  // https://code.google.com/p/android/issues/detail?id=19827
  // ex: Galaxy Tab P3110 + Android 4.1.1
  pointerEvent.preventDefault();
};


/**
 * Wrap and relay a pointer event.  Note that this requires that the type
 * string for the MapBrowserPointerEvent matches the PointerEvent type.
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @private
 */
MapBrowserEventHandler.prototype.relayEvent_ = function(pointerEvent) {
  var dragging = !!(this.down_ && this.isMoving_(pointerEvent));
  this.dispatchEvent(new MapBrowserPointerEvent(
      pointerEvent.type, this.map_, pointerEvent, dragging));
};


/**
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @return {boolean} Is moving.
 * @private
 */
MapBrowserEventHandler.prototype.isMoving_ = function(pointerEvent) {
  return Math.abs(pointerEvent.clientX - this.down_.clientX) > this.moveTolerance_ ||
      Math.abs(pointerEvent.clientY - this.down_.clientY) > this.moveTolerance_;
};


/**
 * @inheritDoc
 */
MapBrowserEventHandler.prototype.disposeInternal = function() {
  if (this.relayedListenerKey_) {
    _ol_events_.unlistenByKey(this.relayedListenerKey_);
    this.relayedListenerKey_ = null;
  }
  if (this.pointerdownListenerKey_) {
    _ol_events_.unlistenByKey(this.pointerdownListenerKey_);
    this.pointerdownListenerKey_ = null;
  }

  this.dragListenerKeys_.forEach(_ol_events_.unlistenByKey);
  this.dragListenerKeys_.length = 0;

  if (this.documentPointerEventHandler_) {
    this.documentPointerEventHandler_.dispose();
    this.documentPointerEventHandler_ = null;
  }
  if (this.pointerEventHandler_) {
    this.pointerEventHandler_.dispose();
    this.pointerEventHandler_ = null;
  }
  EventTarget.prototype.disposeInternal.call(this);
};
export default MapBrowserEventHandler;
