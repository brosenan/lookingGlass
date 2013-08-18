# TOC
   - [util](#util)
     - [seq(funcs, done)](#util-seqfuncs-done)
       - [_.to(names...)](#util-seqfuncs-done-_tonames)
     - [timeUid()](#util-timeuid)
   - [MongoFS](#mongofs)
     - [.get(path, callback(err, file))](#mongofs-getpath-callbackerr-file)
     - [.put(path, file, callback(err))](#mongofs-putpath-file-callbackerr)
     - [.batchPut(keyVals, callback(err))](#mongofs-batchputkeyvals-callbackerr)
     - [.getDir(path, expandFiles, callback(err, content))](#mongofs-getdirpath-expandfiles-callbackerr-content)
     - [.remove(path, timestamp, callback(err))](#mongofs-removepath-timestamp-callbackerr)
     - [.createMapping(path, mapping, callback(err, actions))](#mongofs-createmappingpath-mapping-callbackerr-actions)
       - [with .put()](#mongofs-createmappingpath-mapping-callbackerr-actions-with-put)
     - [.removeMapping(path, tsid, callback(err, actions))](#mongofs-removemappingpath-tsid-callbackerr-actions)
<a name=""></a>
 
<a name="util"></a>
# util
<a name="util-seqfuncs-done"></a>
## seq(funcs, done)
should return a function that runs asynchronous functions in funcs in order.

```js
var d;
var f = util.seq([
	function(_) {d = done; setTimeout(_, 10);},
	function(_) {d();}
], function() {});
f();
```

should handle errors by calling done with the error.

```js
util.seq([
	function(_) {_(new Error('someError'));},
	function(_) {assert(0, 'This should not be called'); _()}
], function(err) { assert.equal(err.message, 'someError'); done(); })();
```

should handle exceptions thrown by functions by calling done with the exception.

```js
util.seq([
	function(_) { throw new Error('someError');},
	function(_) {assert(0, 'This should not be called'); _()}
], function(err) { assert.equal(err.message, 'someError'); done(); })();
```

should call done with no error if all is successful.

```js
util.seq([
	function(_) {setTimeout(_, 10);},
	function(_) {setTimeout(_, 10);},
	function(_) {setTimeout(_, 10);}
], done)();
```

<a name="util-seqfuncs-done-_tonames"></a>
### _.to(names...)
should return a function that places the corresponding arguments in "this" (skipping err).

```js
util.seq([
	function(_) { _.to('a', 'b', 'c')(undefined, 1, 2, 3); },
	function(_) { assert.equal(this.a, 1); _(); },
	function(_) { assert.equal(this.b, 2); _(); },
	function(_) { assert.equal(this.c, 3); _(); },
], done)();
```

<a name="util-timeuid"></a>
## timeUid()
should return a unique string.

```js
var vals = {};
for(var i = 0; i < 10000; i++) {
	var tuid = util.timeUid();
	assert.equal(typeof(tuid), 'string');
	assert(!(tuid in vals), 'Value not unique');
	vals[tuid] = 1;
}
```

should return a larger value when called over one millisecond later.

```js
var a, b;
util.seq([
	function(_) { a = util.timeUid(); setTimeout(_, 2); },
	function(_) { b = util.timeUid(); setTimeout(_, 2); },
	function(_) { assert(b > a, 'Later value is not larger than earlier'); _();},
], done)();
```

<a name="mongofs"></a>
# MongoFS
should retrieve the value with placed with the highest _ts value.

```js
util.seq([
	function(_) {mfs.put('/some/path/to/doc', {foo: 'bar', _ts: 1000}, _); },
	function(_) {mfs.put('/some/path/to/doc', {foo: 'baz', _ts: 3000}, _); },
	function(_) {mfs.put('/some/path/to/doc', {foo: 'bat', _ts: 2000}, _); },
	function(_) {
		mfs.get('/some/path/to/doc', protect(done, function(err, file) {
			assert.equal(file.foo, 'baz');
			_();
		}));
	}
], done)();
```

<a name="mongofs-getpath-callbackerr-file"></a>
## .get(path, callback(err, file))
should retrieve the value of a file.

```js
mfs.get('/hello/a', protect(done, function(err, result) {
	assert.equal(result.foo, 'bar');
	done();
}));
```

should retrieve the last value in the array, regardless of the _ts value.

```js
mfs.get('/hello/b', protect(done, function(err, result) {
	assert.equal(result.value, 'last');
	done();
}));
```

<a name="mongofs-putpath-file-callbackerr"></a>
## .put(path, file, callback(err))
should write a file so that get() retrieves it.

```js
mfs.put('/hello/world', {hello: 'world'}, protect(done, function(err) {
	mfs.get('/hello/world', protect(done, function(err, file) {
		assert.equal(file.hello, 'world', done);
		done();
	}));
}));
```

should assign a timestamp to a file if one is not provided.

```js
mfs.put('/hello/file', {key: 123}, protect(done, function(err) {
	mfs.get('/hello/file', protect(done, function(err, file) {
		var ts = file._ts;
		assert(ts, 'file timestamp');
		var now = util.timeUid();
		assert(now > ts, 'now > ts');
		done();
	}));
}));
```

should reflect the provided timestamp if one is given.

```js
mfs.put('/hello/someOtherFile', {foo: 'bar', _ts: 100}, protect(done, function(err) {
	mfs.get('/hello/someOtherFile', protect(done, function(err, file) {
		assert.equal(file._ts, 100);
		done();
	}));
}));
```

<a name="mongofs-batchputkeyvals-callbackerr"></a>
## .batchPut(keyVals, callback(err))
should put files for all key/value pairs in the given object.

```js
var valuesToInsert = {'/a/b/c': {foo:'bar'}, '/g/h': {hello: 'world'}, '/tee/pee': {a: 1, b: 2, _ts: 800}};
mfs.batchPut(valuesToInsert, protect(done, function(err) {
	mfs.get('/a/b/c', protect(done, function(err, file) {
		assert.equal(file.foo, 'bar');
		mfs.get('/g/h', protect(done, function(err, file) {
			assert.equal(file.hello, 'world');
			mfs.get('/tee/pee', protect(done, function(err, file) {
				assert.equal(file.b, 2);
				done();
			}));
		}));
	}));
}));
```

<a name="mongofs-getdirpath-expandfiles-callbackerr-content"></a>
## .getDir(path, expandFiles, callback(err, content))
should retrieve the names of all files and sub-dirs in the directory.

```js
mfs.getDir('/a/', false, protect(done, function(err, content) {
	assert(content['b/'], 'b/');
	assert(content['j/'], 'j/');
	done();
}));
```

should retrieve the values of all files in the directory, if expandFiles is set to true.

```js
mfs.getDir('/a/b/', true, protect(done, function(err, content) {
	assert.equal(content.c.a, 1);
	assert.equal(content.d.a, 2);
	assert.equal(content.e.a, 3);
	done();
}));
```

<a name="mongofs-removepath-timestamp-callbackerr"></a>
## .remove(path, timestamp, callback(err))
should remove a file of the given path.

```js
mfs.remove('/file/to/delete', 0, protect(done, function(err) {
	mfs.get('/file/to/delete', util.shouldFail(done, 'File should not exist', function(err) {
		assert(err.fileNotFound, 'File should not exist');
		done();
	}));
}));
```

sould remove a file only if the removal timestamp is greater than the latest.

```js
mfs.remove('/file/to/delete', 900, protect(done, function(err) {
	mfs.get('/file/to/delete', protect(done, function(err, value) {
		assert.equal(value.foo, 'bar');
		done();
	}));
}));
```

<a name="mongofs-createmappingpath-mapping-callbackerr-actions"></a>
## .createMapping(path, mapping, callback(err, actions))
should add an entry in the ".m" sub-document of the directory.

```js
mfs.createMapping('/a/b/', {map: 123}, protect(done, function(err, actions) {
	coll.find({_id: '/a/b/'}).toArray(protect(done, function(err, array) {
		assert.equal(array.length, 1);
		assert(array[0].m, 'mapping sub-doc must exist');
		for(var key in array[0].m) {
			// This should be the only one...
			assert.equal(array[0].m[key].map, 123);
		}
		done();
	}));
}));
```

should emit actions including the mapping for all files in the directory.

```js
mfs.createMapping('/a/b/', {map: 123}, protect(done, function(err, actions) {
	var mappings = actionsToMappings(actions);
	assert(mappings['map:/a/b/c'], 'Valid mapping for /a/b/c');
	assert(mappings['map:/a/b/d'], 'Valid mapping for /a/b/d');
	assert(mappings['map:/a/b/e'], 'Valid mapping for /a/b/e');
	done();
}));
```

should emit actions so that when sending the "tramp" actions back, we get mappings for all files in the sub-tree.

```js
mfs.createMapping('/a/b/', {map: 123}, protect(done, function(err, actions) {
	trampoline(mfs, actions, protect(done, function(err, actions) {
		var mappings = actionsToMappings(actions);
		assert(mappings['map:/a/b/c'], 'Valid mapping for /a/b/c');
		assert(mappings['map:/a/b/d'], 'Valid mapping for /a/b/d');
		assert(mappings['map:/a/b/e'], 'Valid mapping for /a/b/e');
		assert(mappings['map:/a/b/f/g'], 'Valid mapping for /a/b/f/g');
		done();
	}));
}));
```

should work whether or not the directory already exists.

```js
mfs.createMapping('/qwe/rty/', {foo: 'bar'}, protect(done, function(err, actions) {
	mfs.put('/qwe/rty/uio', {baz: 'bat'}, protect(done, function(err, actions2) {
		assert.equal(actions2.length, 1);
		assert.equal(actions2[0].type, 'map');
		assert.equal(actions2[0].mapping.foo, 'bar');
		assert.equal(actions2[0].path, '/qwe/rty/uio');
		done();
	}));
}));
```

<a name="mongofs-createmappingpath-mapping-callbackerr-actions-with-put"></a>
### with .put()
should cause subsequent calls to .put() emit the mapping for the new object.

```js
mfs.put('/a/b/g', {a:7}, protect(done, function(err, actions) {
	for(var i = 0; i < actions.length; i++) {
		if(actions[i].type == 'map' && 
			actions[i].mapping.map == 333 && 
			actions[i].path == '/a/b/g') {
			return done();
		}
	}
	done(new Error('Could not find action relating to this mapping. Found: ' + JSON.stringify(actions)));
}));
```

should cause put() that overrides an existing value provide mapping for the new value and unmapping for the old one.

```js
util.seq([
	function(_) { mfs.put('/x/y', {value: 'old'}, _); },
	function(_) { mfs.createMapping('/x/', {map: 1}, _.to('actions')); },
	function(_) { trampoline(mfs, this.actions, _); },
	function(_) { setTimeout(_, 2); },
	function(_) { mfs.put('/x/y', {value: 'new'}, _.to('actions')); },
	function(_) {
		var mappings = actionsToMappings(this.actions);
		assert(mappings['map:/x/y'], 'New value mapped');
		assert.equal(mappings['map:/x/y'].content.value, 'new');
		assert(mappings['unmap:/x/y'], 'Old value unmapped');
		assert.equal(mappings['unmap:/x/y'].content.value, 'old');
		_();
	},
], done)();
```

<a name="mongofs-removemappingpath-tsid-callbackerr-actions"></a>
## .removeMapping(path, tsid, callback(err, actions))
should remove the mapping with tsid from path, and produce actions to undo its effect.

```js
util.seq([
	function(_) { mfs.removeMapping('/e/f/', mapping._ts, _.to('actions')); },
	function(_) { trampoline(mfs, this.actions, _.to('actions')); },
	function(_) { 
		var mapping = actionsToMappings(this.actions);
		assert(mapping['unmap:/e/f/g'], 'unmap:/e/f/g');
		assert(mapping['unmap:/e/f/h'], 'unmap:/e/f/h');
		assert(mapping['unmap:/e/f/i/j'], 'unmap:/e/f/i/j');
		assert(mapping['unmap:/e/f/i/k'], 'unmap:/e/f/i/k');
		_();
	},
], done)();
```

