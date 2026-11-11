

function notFound() {
  return {
    statusCode: 404,
    statusDescription: 'Not Found',
    headers: { 'content-type': { value: 'text/plain; charset=utf-8' } },
    body: { encoding: 'text', data: 'Not found' },
  };
}

function handler(event) {
  var request = event.request;
  var hostHeader = request.headers.host;
  if (!hostHeader) return notFound();

  var id = hostHeader.value.toLowerCase().split('.')[0];
  if (!/^[a-z0-9]{10}$/.test(id)) return notFound();

  var uri = request.uri;
  if (uri.indexOf('..') !== -1 || uri.indexOf('\\') !== -1) return notFound();

  if (uri.charAt(uri.length - 1) === '/') {
    uri = uri + 'index.html';
  } else {
    var last = uri.split('/').pop();
    if (!/\.[A-Za-z0-9]+$/.test(last)) uri = '/index.html';
  }

  request.uri = '/' + id + uri;
  return request;
}
