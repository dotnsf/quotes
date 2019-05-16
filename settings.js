exports.db_username = '';
exports.db_password = '';
exports.db_name = 'quotes';
exports.nlc_apikey = '';
exports.nlc_url = 'https://gateway.watsonplatform.net/natural-language-classifier/api';
exports.nlc_name = 'quotes';
exports.nlc_language = 'ja';
exports.app_port = 0;

exports.doc_limit = 5;
exports.max_target_nums = 3;

exports.hostname = 'quotes.mybluemix.net';
exports.basic_username = 'username';
exports.basic_password = 'password';
exports.appname = 'quotes';

if( process.env.VCAP_SERVICES ){
  var VCAP_SERVICES = JSON.parse( process.env.VCAP_SERVICES );
  if( VCAP_SERVICES && VCAP_SERVICES.cloudantNoSQLDB ){
    exports.db_username = VCAP_SERVICES.cloudantNoSQLDB[0].credentials.username;
    exports.db_password = VCAP_SERVICES.cloudantNoSQLDB[0].credentials.password;
  }
  if( VCAP_SERVICES && VCAP_SERVICES.natural_language_classifier ){
    exports.nlc_apikey = VCAP_SERVICES.natural_language_classifier[0].credentials.apikey;
    exports.nlc_username = VCAP_SERVICES.natural_language_classifier[0].credentials.username;
    exports.nlc_password = VCAP_SERVICES.natural_language_classifier[0].credentials.password;
    exports.nlc_url = VCAP_SERVICES.natural_language_classifier[0].credentials.url;
  }
}

