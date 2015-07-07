module.exports.CoapHandler = function(fn) {
	this.allowedMethods = ['GET'];
	this.fn = fn;
	var that = this;
	this.handle = function(req, res) {
		console.log('incoming request for url '+req.url);
		if(that.allowedMethods.indexOf(req.method) === -1) {
			res.code = 405;
			res.setOption('Content-Format', 'text/plain');
			res.end('Methods other than ' + that.allowedMethods.join(', ') +' are disallowed');
			return;
		}
		that.fn(req, res);
	}
}

