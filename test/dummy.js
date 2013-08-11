var assert = require("assert")

describe('Array', function(){
  describe('.indexOf()', function(){
    it('should return -1 when the value is not present', function(){
      assert.equal(-1, [1,2,3].indexOf(5));
      assert.equal(-1, [1,2,3].indexOf(0));
    })
    it('should return the index when the value is present', function(){
      assert.equal(0, [1,2,3].indexOf(1));
      assert.equal(2, [1,2,3].indexOf(3));
    })
  })
  describe('.push()', function(){
    it('should add a value to the end of the array', function(){
      var a = [1, 2, 3];
      a.push(4);
      assert.equal(4, a.length);
      assert.equal(4, a[3]);
    })
  })
})

var fs = require('fs');
describe('fs', function(){
	describe('#createReadStream', function(){
		before(function(done) {
			var f = fs.createWriteStream('hello.txt');
			f.end('Hello, World', done);
		});
		after(function(done) {
			fs.unlink('hello.txt', done);
		});
		it('should read the content of a given file', function(done) {
			var f = fs.createReadStream('hello.txt');
			var str = '';
			f.on('data', function(data) {
				str += data.toString('utf-8');
			});
			f.on('end', function(err) {
				if(err) return done(err);
				assert.equal('Hello, World', str);
				done();
			});
		});
	});
});

