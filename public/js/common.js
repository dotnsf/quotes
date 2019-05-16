
function logout(){
  var obj = getBusyOverlay( 'viewport', {color:'black', opacity:0.5, text:'loading', style:'text-decoration:blink; font-weight:bold; font-size:12px; color:white;' } );
  $.ajax({
    type: 'POST',
    url: '/logout',
    data: {},
    success: function( data ){
      obj.remove();
      window.location.href = '/';
    },
    error: function(){
      obj.remove();
      window.location.href = '/';
    }
  });
}

function abbreviateArray( arr ){
  var str = '[';
  if( arr && Array.isArray( arr ) && arr.length > 0 ){
    if( typeof( arr[0] ) == 'string' ){
      str += '"' + arr[0] + '"';
    }else{
      str += arr[0];
    }
    if( arr.length > 1 ){
      str += ',..'
    }
  }
  str += ']';

  return str;
}
