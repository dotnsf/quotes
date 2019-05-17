// app.js

var bodyParser = require( 'body-parser' );
var Cloudantlib = require( '@cloudant/cloudant' );
var cfenv = require( 'cfenv' );
var express = require( 'express' );
var basicAuth = require( 'basic-auth-connect' );
var fs = require( 'fs' );
var multer = require( 'multer' );
var os = require( 'os' );
//var request = require( 'request' );
var uuidv1 = require( 'uuid/v1' );
var nlcv1 = require( 'watson-developer-cloud/natural-language-classifier/v1' );

var app = express();

var settings = require( './settings' );
var appEnv = cfenv.getAppEnv();

var db = null;
var cloudant = null;
if( settings.db_username && settings.db_password ){
  var params = { account: settings.db_username, password: settings.db_password };
  if( settings.db_hostname ){
    var protocol = settings.db_protocol ? settings.db_protocol : 'http';
    var url = protocol + '://' + settings.db_username + ":" + settings.db_password + "@" + settings.db_hostname;
    if( settings.db_port ){
      url += ( ":" + settings.db_port );
    }
    params = { url: url };
  }
  cloudant = Cloudantlib( params );

  if( cloudant ){
    cloudant.db.get( settings.db_name, function( err, body ){
      if( err ){
        if( err.statusCode == 404 ){
          cloudant.db.create( settings.db_name, function( err, body ){
            if( err ){
              //. 'Error: server_admin access is required for this request' for Cloudant Local
              //. 'Error: insernal_server_error'
              db = null;
            }else{
              db = cloudant.db.use( settings.db_name );
              //. デザインドキュメント作成
              createDesignDocuments();
            }
          });
        }else{
          db = null;
        }
      }else{
        db = cloudant.db.use( settings.db_name );
        db.get( "_design/documents", {}, function( err, body ){
          if( err ){
            //. デザインドキュメント作成
            createDesignDocuments();
          }else{
          }
        });
      }
    });
  }
}

var nlc = null;
/* New Watson IAM authorization
if( settings.nlc_username && settings.nlc_password ){
  var url = ( settings.nlc_url ? settings.nlc_url : 'https://gateway.watsonplatform.net/natural-language-classifier/api/' );
  nlc = new nlcv1({
    username: settings.nlc_username,
    password: settings.nlc_password,
    version: 'v1',
    url: url
  });
}
*/
if( settings.nlc_apikey ){
  var url = ( settings.nlc_url ? settings.nlc_url : 'https://gateway.watsonplatform.net/natural-language-classifier/api/' );
  nlc = new nlcv1({
    iam_apikey: settings.nlc_apikey,
    version: '2018-03-19',
    url: url
  });
}


app.all( '/*', basicAuth( function( user, pass ){
  if( settings.basic_username && settings.basic_password ){
    return ( settings.basic_username === user && settings.basic_password === pass );
  }else{
    return true;
  }
}));

app.use( express.static( __dirname + '/public' ) );
app.use( multer( { dest: './tmp/' } ).single( 'file' ) );
app.use( bodyParser.urlencoded( { extended: true }) );  //. body-parser deprecated undefined extended
app.use( bodyParser.json() );

app.set( 'views', __dirname + '/template' );
app.set( 'view engine', 'ejs' );

app.get( '/', function( req, res ){
  //res.render( 'index', { settings: settings } );
  res.render( 'index_new', { settings: settings } );
});

app.get( '/new', function( req, res ){
  res.render( 'index_new', { settings: settings } );
});

app.get( '/document/:id', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  var id = req.params.id;
  console.log( 'GET /document/' + id );

  if( db ){
    db.get( id, { include_docs: true }, function( err, doc ){
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
        res.end();
      }else{
        res.write( JSON.stringify( { status: true, doc: doc }, 2, null ) );
        res.end();
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

app.get( '/documents', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  //var type = req.query.type;
  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var offset = req.query.offset ? parseInt( req.query.offset ) : 0;
  console.log( 'GET /documents?limit=' + limit + '&offset=' + offset );

  if( db ){
    /* list() ではこのオプションは使えない
    var option = { include_docs: true };
    if( limit ){ option['limit'] = limit; }
    if( offset ){ option['skip'] = offset; }
    */
    db.list( { include_docs: true }, function( err, body ){
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
        res.end();
      }else{
        var total = body.total_rows - 2;   //. 2 はデザインドキュメントの数
        var docs = [];
        body.rows.forEach( function( doc ){
          var _doc = JSON.parse(JSON.stringify(doc.doc));
          if( _doc._id.indexOf( '_' ) !== 0 ){
            docs.push( _doc );
          }
        });

        docs.sort( compareByTimestampRev ); //. 時系列逆順ソート

        if( offset || limit ){
          docs = docs.slice( offset, offset + limit );
        }

        var result = { status: true, total: total, limit: limit, offset: offset, docs: docs };
        res.write( JSON.stringify( result, 2, null ) );
        res.end();
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

app.get( '/query', function( req, res ){   //. カテゴリー検索
  res.contentType( 'application/json; charset=utf-8' );
  //var type = req.query.type;
  var category = req.query.category ? req.query.category : '';   //. カテゴリー名
  var subcategory = req.query.subcategory ? req.query.subcategory : '';      //. 名言
  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var offset = req.query.offset ? parseInt( req.query.offset ) : 0;
  console.log( 'GET /query?category=' + category + '&subcategory=' + subcategory + '&limit=' + limit + '&offset=' + offset );

  if( db ){
    if( category ){
      var option = { selector: { category: category } };
    }
    if( subcategory ){
      option['selector']['subcategory'] = subcategory;
    }
    if( limit ){ option['limit'] = limit; }
    if( offset ){ option['skip'] = offset; }
    db.find( option, function( err, body ){
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
        res.end();
      }else{
        var docs = [];
        body.docs.forEach( function( doc ){
          if( doc._id.indexOf( '_' ) !== 0 ){
            docs.push( doc );
          }
        });

        var result = { status: true, docs: docs };
        res.write( JSON.stringify( result, 2, null ) );
        res.end();
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

//. 新規学習データ追加
app.post( '/uploadTSV', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  console.log( 'POST /uploadTSV' );

  if( db ){
    var resetdata = req.body.resetdata;
    if( resetdata ){
      db.list( {}, function( err, body ){
        if( !err ){
          var docs = [];
          body.rows.forEach( function( doc ){
            var _id = doc.id;
            if( _id.indexOf( '_' ) !== 0 ){
              var _rev = doc.value.rev;
              docs.push( { _id: _id, _rev: _rev, _deleted: true } );
            }
          });
          if( docs.length > 0 ){
            db.bulk( { docs: docs }, function( err ){
              if( req.file && req.file.path ){
                var filepath = req.file.path;
                var filetype = req.file.mimetype;
                var filename = req.file.originalname;
                var ext = filetype.split( "/" )[1];

                fs.readFile( filepath, 'utf-8', function( err, text ){
                  if( err ){
                    res.status( 400 );
                    res.write( JSON.stringify( { status: false, message: 'No file found.' }, 2, null ) );
                    res.end();
                  }else{
                    var docs_for_upload = [];
                    var lines = text.split( "\n" );
                    lines.forEach( function( line ){
                      var tmp = line.split( "\t" );
                      if( tmp.length > 3 ){
                        var doc = {};
                        doc.category = tmp[0];
                        doc.subcategory = tmp[1];
                        doc.quote = tmp[2];
                        doc.author = tmp[3];
                        doc.timestamp = ( new Date() ).getTime();

                        //. バルクアップロード対応
                        docs_for_upload.push( doc );
                        if( docs_for_upload.length >= 200 ){
                          db.bulk( { docs: docs_for_upload }, function( err ){} );
                          docs_for_upload = [];
                        }
                      }
                    });

                    if( docs_for_upload.length > 0 ){
                      db.bulk( { docs: docs_for_upload }, function( err ){} );
                    }

                    fs.unlink( filepath, function( err ){} );

                    res.write( JSON.stringify( { status: true }, 2, null ) );
                    res.end();
                  }
                });
              }else{
                res.status( 400 );
                res.write( JSON.stringify( { status: false, message: 'No file found.' }, 2, null ) );
                res.end();
              }
            });
          }
        }
      });
    }else{
      if( req.file && req.file.path ){
        var filepath = req.file.path;
        var filetype = req.file.mimetype;
        var filename = req.file.originalname;
        var ext = filetype.split( "/" )[1];

        fs.readFile( filepath, 'utf-8', function( err, text ){
          if( err ){
            res.status( 400 );
            res.write( JSON.stringify( { status: false, message: 'No file found.' }, 2, null ) );
            res.end();
          }else{
            var docs_for_upload = [];
            var lines = text.split( "\n" );
            lines.forEach( function( line ){
              var tmp = line.split( "\t" );
              if( tmp.length > 3 ){
                var doc = {};
                doc.category = tmp[0];
                doc.subcategory = tmp[1];
                doc.quote = tmp[2];
                doc.author = tmp[3];
                doc.timestamp = ( new Date() ).getTime();

                //. バルクアップロード対応
                docs_for_upload.push( doc );
                if( docs_for_upload.length >= 200 ){
                  db.bulk( { docs: docs_for_upload }, function( err ){} );
                  docs_for_upload = [];
                }
              }
            });

            if( docs_for_upload.length > 0 ){
              db.bulk( { docs: docs_for_upload }, function( err ){} );
            }

            fs.unlink( filepath, function( err ){} );

            res.write( JSON.stringify( { status: true }, 2, null ) );
            res.end();
          }
        });
      }else{
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: 'No file found.' }, 2, null ) );
        res.end();
      }
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});


app.delete( '/document/:id', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  var id = req.params.id;
  console.log( 'DELETE /document/' + id );

  if( db ){
    db.get( id, function( err, doc ){
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
        res.end();
      }else{
        db.destroy( id, doc._rev, function( err, body ){
          if( err ){
            res.status( 400 );
            res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
            res.end();
          }else{
            res.write( JSON.stringify( { status: true }, 2, null ) );
            res.end();
          }
        });
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

app.delete( '/documents', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  console.log( 'DELETE /documents' );

  if( db ){
    var docs = req.body.docs;
    if( docs && docs.length ){
      var n = docs.length;
      docs.forEach( function( doc ){
        doc['_deleted'] = true;
      });
      //console.log( docs );
      db.bulk( { docs: docs }, function( err, body ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
          res.end();
        }else{
          res.write( JSON.stringify( { status: true, message: n + ' docs deleted.' }, 2, null ) );
          res.end();
        }
      });
    }else{
      /*
      db.list( {}, function( err, body ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
          res.end();
        }else{
          var docs = [];
          body.rows.forEach( function( doc ){
            var _id = doc.id;
            if( _id.indexOf( '_' ) !== 0 ){
              var _rev = doc.value.rev;
              docs.push( { _id: _id, _rev: _rev, _deleted: true } );
            }
          });
          if( docs.length > 0 ){
            db.bulk( { docs: docs }, function( err ){
              res.write( JSON.stringify( { status: true, message: docs.length + ' documents are deleted.' }, 2, null ) );
              res.end();
            });
          }else{
            res.write( JSON.stringify( { status: true, message: 'No documents to be deleted found.' }, 2, null ) );
            res.end();
          }
        }
      });
      */
      res.write( JSON.stringify( { status: true, message: 'No documents to be deleted found.' }, 2, null ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});


app.post( '/reset', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  console.log( 'POST /reset' );

  if( db ){
    db.list( {}, function( err, body ){
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
        res.end();
      }else{
        var docs = [];
        body.rows.forEach( function( doc ){
          var _id = doc.id;
          if( _id.indexOf( '_' ) !== 0 ){
            var _rev = doc.value.rev;
            docs.push( { _id: _id, _rev: _rev, _deleted: true } );
          }
        });
        if( docs.length > 0 ){
          db.bulk( { docs: docs }, function( err ){
            res.write( JSON.stringify( { status: true, message: docs.length + ' documents are deleted.' }, 2, null ) );
            res.end();
          });
        }else{
          res.write( JSON.stringify( { status: true, message: 'No documents need to be deleted.' }, 2, null ) );
          res.end();
        }
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});


app.post( '/classify', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  console.log( 'POST /classify' );

  var idx = ( req.body.idx ? req.body.idx : '1' );

  if( nlc ){
    nlc.listClassifiers( {}, ( err1, body1 ) => {
      if( err1 ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: err1 }, 2, null ) );
        res.end();
      }else{
        var classifier_id = null;
        if( body1 && body1.classifiers && body1.classifiers.length ){
          body1.classifiers.forEach( function( classifier ){
            if( classifier.name == ( settings.nlc_name + idx ) ){
              classifier_id = classifier.classifier_id;
            }
          });
        }
        if( classifier_id ){
          var params2 = {
            classifier_id: classifier_id,
            text: removeHtmlTag( req.body.text )
          };
          nlc.classify( params2, ( err2, body2 ) => {
            if( err2 ){
              res.status( 400 );
              res.write( JSON.stringify( { status: false, message: err2 }, 2, null ) );
              res.end();
            }else{
              res.write( JSON.stringify( { status: true, classes: body2.classes }, 2, null ) );
              res.end();
            }
          });
        }else{
          res.status( 400 );
          res.write( JSON.stringify( { status: false, message: 'No NLC available.' }, 2, null ) );
          res.end();
        }
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'No NLC available.' }, 2, null ) );
    res.end();
  }
});

app.get( '/trainingNLC', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  console.log( 'GET /trainingNLC' );

  //. 現在の classifiers 一覧
  if( nlc ){
    //. http://watson-developer-cloud.github.io/node-sdk/master/classes/naturallanguageclassifierv1.htmlhttp://watson-developer-cloud.github.io/node-sdk/master/classes/naturallanguageclassifierv1.html
    nlc.listClassifiers( {}, ( err1, body1 ) => {
      if( err1 ){
        //console.log( err1 );
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: err1 }, 2, null ) );
        res.end();
      }else{
        //console.log( body1 );
        var classifier_id1 = null;
        var classifier_id2 = null;
        if( body1 && body1.classifiers && body1.classifiers.length ){
          body1.classifiers.forEach( function( classifier ){
            if( classifier.name == ( settings.nlc_name + '1' ) ){
              classifier_id1 = classifier.classifier_id;
            }else if( classifier.name == ( settings.nlc_name + '2' ) ){
              classifier_id2 = classifier.classifier_id;
            }
          });
        }
        console.log( 'classifier_id1 = ' + classifier_id1 );
        console.log( 'classifier_id2 = ' + classifier_id2 );
        if( classifier_id1 && classifier_id2 ){
          var params2 = { classifier_id: classifier_id1 };
          nlc.getClassifier( params2, ( err2, body2 ) => {
            if( err2 ){
              res.status( 400 );
              res.write( JSON.stringify( { status: false, message: err2 }, 2, null ) );
              res.end();
            }else{
              var params3 = { classifier_id: classifier_id2 };
              nlc.getClassifier( params3, ( err3, body3 ) => {
                if( err3 ){
                  res.status( 400 );
                  res.write( JSON.stringify( { status: false, message: err3 }, 2, null ) );
                  res.end();
                }else{
                  res.write( JSON.stringify( { status: true, body1: body2, body2: body3 }, 2, null ) );
                  res.end();
                }
              });
            }
          });
        }else{
          res.status( 400 );
          res.write( JSON.stringify( { status: false, message: 'No NLC available.' }, 2, null ) );
          res.end();
        }
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'No NLC available.' }, 2, null ) );
    res.end();
  }
});

app.post( '/trainingNLC', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  console.log( 'POST /trainingNLC' );
  //console.log( req.body );

  if( db ){
    db.list( { include_docs: true }, function( err, body ){
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
        res.end();
      }else{
        var docs = [];
        var training_lang = ( settings.nlc_language ? settings.nlc_language : 'en' );
        var training_data1 = '';
        var training_data2 = '';
        var training_metadata1 = '{"language":"' + training_lang + '","name":"' + settings.nlc_name + '1"}';
        var training_metadata2 = '{"language":"' + training_lang + '","name":"' + settings.nlc_name + '2"}';
        body.rows.forEach( function( doc ){
          var _doc = JSON.parse(JSON.stringify(doc.doc));
          if( _doc._id.indexOf( '_' ) !== 0 ){
            //. 1: quote,category
            var line1 = _doc.quote + "," + _doc.category + os.EOL;
            training_data1 += line1;

            //. 2: quote,subcategory
            var line2 = _doc.quote + "," + _doc.subcategory + os.EOL;
            training_data2 += line2;
            line2 = sanitizeForPattern2( _doc.quote ) + "," + _doc.subcategory + os.EOL;
            training_data2 += line2;
          }
        });
        //console.log( 'training_data1' );
        //console.log( training_data1 );
        //console.log( 'training_data2' );
        //console.log( training_data2 );

        //. 現在の classifiers 一覧
        if( nlc ){
          //. http://watson-developer-cloud.github.io/node-sdk/master/classes/naturallanguageclassifierv1.htmlhttp://watson-developer-cloud.github.io/node-sdk/master/classes/naturallanguageclassifierv1.html
          nlc.listClassifiers( {}, ( err1, body1 ) => {
            if( err1 ){
              res.status( 400 );
              res.write( JSON.stringify( { status: false, message: err1 }, 2, null ) );
              res.end();
            }else{
              var classifier_id1 = null;
              var classifier_id2 = null;
              if( body1 && body1.classifiers && body1.classifiers.length ){
                body1.classifiers.forEach( function( classifier ){
                  if( classifier.name == ( settings.nlc_name + '1' ) ){
                    classifier_id1 = classifier.classifier_id;
                  }else if( classifier.name == ( settings.nlc_name + '2' ) ){
                    classifier_id2 = classifier.classifier_id;
                  }
                });
              }

              if( classifier_id1 || classifier_id2 ){
                if( classifier_id1 ){
                  nlc.deleteClassifier( { classifier_id: classifier_id1 }, ( err2, body1 ) => {
                    if( err2 ){
                      //res.status( 400 );
                      //res.write( JSON.stringify( { status: false, message: err2 }, 2, null ) );
                      //res.end();
                    }else{
                      var params3 = {
                        metadata: new Buffer( training_metadata1, 'UTF-8' ),
                        training_data: new Buffer( training_data1, 'UTF-8' )
                      };
                      nlc.createClassifier( params3, ( err3, body3 ) => {
                        if( err3 ){
                        }else{
                        }
                      });
                    }
                  });
                }
                if( classifier_id2 ){
                  nlc.deleteClassifier( { classifier_id: classifier_id2 }, ( err2, body1 ) => {
                    if( err2 ){
                    }else{
                      var params3 = {
                        metadata: new Buffer( training_metadata2, 'UTF-8' ),
                        training_data: new Buffer( training_data2, 'UTF-8' )
                      };
                      nlc.createClassifier( params3, ( err3, body3 ) => {
                        if( err3 ){
                        }else{
                        }
                      });
                    }
                  });
                }

                res.write( JSON.stringify( { status: true, message: 'POST /trainingNLC completed.' }, 2, null ) );
                res.end();
              }else{
                var params3 = {
                  metadata: new Buffer( training_metadata1, 'UTF-8' ),
                  training_data: new Buffer( training_data1, 'UTF-8' )
                };
                nlc.createClassifier( params3, ( err3, body3 ) => {
                  if( err3 ){
                  }else{
                  }
                });
                var params4 = {
                  metadata: new Buffer( training_metadata2, 'UTF-8' ),
                  training_data: new Buffer( training_data2, 'UTF-8' )
                };
                nlc.createClassifier( params4, ( err4, body4 ) => {
                  if( err4 ){
                  }else{
                  }
                });

                res.write( JSON.stringify( { status: true, message: 'POST /trainingNLC completed.' }, 2, null ) );
                res.end();
              }
            }
          });
        }else{
          res.status( 400 );
          res.write( JSON.stringify( { status: false, message: 'No NLC available.' }, 2, null ) );
          res.end();
        }
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

app.delete( '/trainingNLC', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  console.log( 'DELETE /trainingNLC' );
  //console.log( req.body );

  if( nlc ){
    nlc.listClassifiers( {}, ( err1, body1 ) => {
      if( err1 ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: err1 }, 2, null ) );
        res.end();
      }else{
        var classifier_id = null;
        var classifier_id1 = null;
        var classifier_id2 = null;
        if( body1 && body1.classifiers && body1.classifiers.length ){
          body1.classifiers.forEach( function( classifier ){
            if( classifier.name == ( settings.nlc_name + '1' ) ){
              classifier_id1 = classifier.classifier_id;
            }else if( classifier.name == ( settings.nlc_name + '2' ) ){
              classifier_id2 = classifier.classifier_id;
            }else if( classifier.name == settings.nlc_name ){
              classifier_id = classifier.classifier_id;
            }
          });
        }

        if( classifier_id1 ){
          nlc.deleteClassifier( { classifier_id: classifier_id1 }, ( err2, body2 ) => {
            if( err2 ){
            }else{
            }
          });
        }

        if( classifier_id2 ){
          nlc.deleteClassifier( { classifier_id: classifier_id2 }, ( err2, body2 ) => {
            if( err2 ){
            }else{
            }
          });
        }

        if( classifier_id ){
          nlc.deleteClassifier( { classifier_id: classifier_id }, ( err2, body2 ) => {
            if( err2 ){
            }else{
            }
          });
        }

        res.write( JSON.stringify( { status: true, message: 'DELETE /trainingNLC completed.' }, 2, null ) );
        res.end();
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'No NLC available.' }, 2, null ) );
    res.end();
  }
});


function compareByTimestamp( a, b ){
  var r = 0;
  if( a.timestamp < b.timestamp ){ r = -1; }
  else if( a.timestamp > b.timestamp ){ r = 1; }

  return r;
}

function compareByTimestampRev( a, b ){
  var r = 0;
  if( a.timestamp < b.timestamp ){ r = 1; }
  else if( a.timestamp > b.timestamp ){ r = -1; }

  return r;
}

function createDesignDocuments(){
  //. デザインドキュメント作成
  var design_doc_doc = {
    _id: "_design/documents",
    language: "javascript",
    views: {
      bytimestamp: {
        map: "function (doc) { if( doc.typestamp ){ emit(doc.timestamp, doc); } }"
      }
    },
    indexes: {
      newSearch: {
        "analyzer": "japanese",
        "index": "function (doc) { index( 'default', [doc.filename,doc.category,doc.task,doc.target].join( ' ' ) ); }"
      }
    }
  };
  db.insert( design_doc_doc, function( err, body ){
    if( err ){
      console.log( "db init: err" );
      console.log( err );
    }else{
      //console.log( "db init: " );
      //console.log( body );
    }
  });

  //. クエリーインデックス作成
  var query_index_category = {
    _id: "_design/category-index",
    language: "query",
    views: {
      "category-index": {
        map: {
          fields: { "category": "asc" },
          partial_filter_selector: {}
        },
        reduce: "_count",
        options: {
          def: {
            fields: [ "category" ]
          }
        }
      }
    }
  };
  db.insert( query_index_category, function( err, body ){
    if( err ){
      console.log( "db init: err" );
      console.log( err );
    }else{
      //console.log( "db init: " );
      //console.log( body );
    }
  });
}

function timestamp2datetime( ts ){
  var dt = new Date( ts );
  var yyyy = dt.getFullYear();
  var mm = dt.getMonth() + 1;
  var dd = dt.getDate();
  var hh = dt.getHours();
  var nn = dt.getMinutes();
  var ss = dt.getSeconds();
  //var datetime = yyyy + '-' + ( mm < 10 ? '0' : '' ) + mm + '-' + ( dd < 10 ? '0' : '' ) + dd
  //  + ' ' + ( hh < 10 ? '0' : '' ) + hh + ':' + ( nn < 10 ? '0' : '' ) + nn + ':' + ( ss < 10 ? '0' : '' ) + ss;
  var datetime = yyyy + '年' + ( mm < 10 ? '0' : '' ) + mm + '月' + ( dd < 10 ? '0' : '' ) + dd + '日';
  return datetime;
}

function sanitizeForCSV( body ){
  body = body.split( ',' ).join( '，' );
  body = body.split( os.EOL ).join( '' );

  return body;
}

function sanitizeForPattern2( body ){
  body = body.split( '、' ).join( '' );
  body = body.split( '。' ).join( '' );

  return body;
}

function removeHtmlTag( html ){
  var text = html.replace(/<("[^"]*"|'[^']*'|[^'">])*>/g,'');
  text = text.split(',').join('');
  return text;
}


var port = settings.app_port || appEnv.port || 3000;
app.listen( port );
console.log( 'server started on ' + port );
