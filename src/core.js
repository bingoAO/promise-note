'use strict';

// asap是一个第三方库，功能类似与setImmediate
var asap = require('asap/raw');

function noop() {}

// States:
//
// 0 - pending
// 1 - fulfilled with _value
// 2 - rejected with _value
// 3 - adopted the state of another promise, _value
//
// once the state is no longer pending (0) it is immutable

// All `_` prefixed properties will be reduced to `_{random number}`
// at build time to obfuscate them and discourage their use.
// We don't use symbols or Object.defineProperty to fully hide them
// because the performance isn't good enough.


// to avoid using try/catch inside critical functions, we
// extract them to here.
var LAST_ERROR = null;
var IS_ERROR = {};
function getThen(obj) {
  try {
    return obj.then;
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}

function tryCallOne(fn, a) {
  try {
    return fn(a);
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}
function tryCallTwo(fn, a, b) {
  try {
    fn(a, b);
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}

module.exports = Promise;

function Promise(fn) {
  if (typeof this !== 'object') {
    throw new TypeError('Promises must be constructed via new');
  }
  if (typeof fn !== 'function') {
    throw new TypeError('Promise constructor\'s argument is not a function');
  }
  this._deferredState = 0;// then的状态
  this._state = 0; // 状态，初始状态是0表示pending,1表示fulfilled,2表示rejected
  this._value = null; // 获取到的值
  this._deferreds = null; //  存储的成功回调和失败回调，以及返回的新Promis的handler
  if (fn === noop) return;
  // new Promise之后开始执行fn回调函数
  doResolve(fn, this);
}
Promise._onHandle = null;
Promise._onReject = null;
Promise._noop = noop;

// 马上执行的 传入两个回调函数
// 回调主要新建promise 进行回调的注册 返回新的promise
Promise.prototype.then = function(onFulfilled, onRejected) {
  console.log('then');
  if (this.constructor !== Promise) {
    return safeThen(this, onFulfilled, onRejected);
  }
  // 注意这里新建了一个promise
  var res = new Promise(noop);
  // 放入处理器中
  handle(this, new Handler(onFulfilled, onRejected, res));
  return res;
};

function safeThen(self, onFulfilled, onRejected) {
  return new self.constructor(function (resolve, reject) {
    var res = new Promise(noop);
    res.then(resolve, reject);
    handle(self, new Handler(onFulfilled, onRejected, res));
  });
}

// 这个函数是调用.then的时候调用或者resolve的时候调用
// 将then中的东西放入deffer中 进行处理
function handle(self, deferred) {
  // 如果当前的状态是可以去处理其他的promise resolve一个promise的情况
  while (self._state === 3) {
    console.log('self',self._state)
    // 将self更新迭代当前的self变成了新的
    self = self._value;
  }
  // 这里貌似目前没有_onHandle
  if (Promise._onHandle) {
    Promise._onHandle(self);
  }
  // 当前还在pending状态
  // 0--没有deferred 1--1个deffered 2--两个或者多个deffer
  // 这里只有0才会进去，deffered是以参数的形式传入的，所以这里的deffered不会被覆盖
  if (self._state === 0) {
    if (self._deferredState === 0) {
      self._deferredState = 1;
      self._deferreds = deferred;
      return;
    }
    if (self._deferredState === 1) {
      self._deferredState = 2;
      self._deferreds = [self._deferreds, deferred];
      return;
    }
    self._deferreds.push(deferred);
    return;
  }
  // 不是pending的情况，解析deffered
  handleResolved(self, deferred);
}

function handleResolved(self, deferred) {
  // 这里是有一个异步的包裹
  asap(function() {
    // 根据当前的状态去调用then中的回调
    var cb = self._state === 1 ? deferred.onFulfilled : deferred.onRejected;
    // 如果只是一个空的.then 根据状态直接解析新的promise 并且传入当前promise的值
    if (cb === null) {
      if (self._state === 1) {
        resolve(deferred.promise, self._value);
      } else {
        reject(deferred.promise, self._value);
      }
      return;
    }
    // 否则调用回调，并且传入当前的值
    var ret = tryCallOne(cb, self._value);
    if (ret === IS_ERROR) {
      reject(deferred.promise, LAST_ERROR);
    } else {
      // 传入.then中处理的值
      resolve(deferred.promise, ret);
    }
  });
}
// 成功之后调用resolve
// resolve的值分情况讨论
function resolve(self, newValue) {
  // Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
  if (newValue === self) {
    return reject(
      self,
      new TypeError('A promise cannot be resolved with itself.')
    );
  }
  // 假设是个对象或者方法
  if (
    newValue &&
    (typeof newValue === 'object' || typeof newValue === 'function')
  ) {
    // 判断这个对象上面是不是有.then
    var then = getThen(newValue);
    // 获取失败 抛出异常
    if (then === IS_ERROR) {
      return reject(self, LAST_ERROR);
    }
    // 这里主要判断是不是同一个then方法
    // 如果resolve的如参是个新的promise 
    // 而且是then是等于原型上的then的情况下
    if (
      then === self.then &&
      newValue instanceof Promise
    ) {
      // 状态置为3 表示可以继续去处理其他promise的值等
      self._state = 3;
      // 当前的值
      self._value = newValue;
      console.log('resolve promise')
      finale(self);
      return;
    } else if (typeof then === 'function') {
      // 如果不是一个promise对象，并且有then方法，这里会绑定then的this指向，并且将它作为promise的回调去执行它
      doResolve(then.bind(newValue), self);
      return;
    }
  }
  console.log('resolve value')
  // 其他情况 更改_state 的状态为fullfilled
  self._state = 1;
  // 保存当前的值
  self._value = newValue;
  finale(self);
}

// 出现错误的情况下 转为拒绝
function reject(self, newValue) {
  self._state = 2;
  self._value = newValue;
  if (Promise._onReject) {
    Promise._onReject(self, newValue);
  }
  finale(self);
}
function finale(self) {
  // 当前只有一个deffer
  if (self._deferredState === 1) {
    handle(self, self._deferreds);
    self._deferreds = null;
  }
  // 有多个
  if (self._deferredState === 2) {
    for (var i = 0; i < self._deferreds.length; i++) {
      handle(self, self._deferreds[i]);
    }
    self._deferreds = null;
  }
}

function Handler(onFulfilled, onRejected, promise){
  this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
  this.onRejected = typeof onRejected === 'function' ? onRejected : null;
  this.promise = promise;
}

/**
 * Take a potentially misbehaving resolver function and make sure
 * onFulfilled and onRejected are only called once.
 *
 * Makes no guarantees about asynchrony.
 */
function doResolve(fn, promise) {
  var done = false;
  // 调用fn 并且传出resolve和reject
  var res = tryCallTwo(fn, function (value) {
    if (done) return;
    // 回调之后状态转换成done
    done = true;
    resolve(promise, value);
  }, function (reason) {
    if (done) return;
    done = true;
    // 重置状态
    reject(promise, reason);
  });
  // 调用fn之后是否返回错误了，如果错误了，则重新标志状态，并且reject
  // 这里的IS_ERROR指向同一个地址
  if (!done && res === IS_ERROR) {
    done = true;
    reject(promise, LAST_ERROR);
  }
}
