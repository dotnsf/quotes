#!/usr/bin/python
# coding:utf-8

# getQuotes3.py

# http://www.meigensyu.com/
from bs4 import BeautifulSoup
import requests

# categories
#categories = { "money": [ 1111 ] }
c_life = [ 1100, 1106, 1103, 1115, 1114, 1118, 1129, 1147 ]
c_love = [ 1139, 1109, 1107, 1104, 1113, 1116, 1112 ]
c_happiness = [ 1108, 1105, 1133, 1117 ]
c_ambition = [ 1111, 1137, 1126, 1101, 1102, 1128 ]
categories = { "life": c_life, "love": c_love, "happiness": c_happiness, "ambition": c_ambition }

# outputfile
outputfile = 'result.tsv'
def appendLine( line ):
    try:
        with open( outputfile, mode='a' ) as f:
            f.write( line + "\n" )
            #f.close()
    except Exception as e:
        print(e)
        pass


def singlePage(url, page, category):
    next_url = ''

    # Retrieve HTML
    html = requests.get( url + page )

    # Convert for BeautifulSoup
    soup = BeautifulSoup( html.text, "html.parser" )

    # next page url
    a = soup.find_all("a")
    for tag in a:
        try:
            string_ = tag.get( "class" ).pop(0)
            if string_ == "next":
                next_url = tag.get( "href" ) #.pop(0)
                break
        except Exception as e:
            #print(e)
            pass

    #print "next_url = " + next_url

    # title(=subcategory)
    subcategory = ''
    h2 = soup.find_all("h2")
    for tag in h2:
        try:
            subcategory = tag.string
        except Exception as e:
            #print(e)
            pass

    # quotes
    div = soup.find_all("div")
    for tag in div:
        try:
            string_ = tag.get( "class" ).pop(0)
            if string_ in "meigenbox":
                quote = ""
                author = ""
                divs = tag.find_all( "div" )
                for div in divs:
                    class_ = div.get( "class" ).pop(0)
                    if class_ in "text":
                        quote = div.string
                    elif class_ in "link":
                        li = div.find_all( "li" ).pop(0)
                        author = li.string

                # quote と author がわかった
                print("[" + category + ":" +  subcategory + "]: " + quote + " (" + author + ")")
                appendLine( category + "\t" + subcategory + "\t" + quote + "\t" + author )

                # break
        except Exception as e:
            #print(e)
            pass

    return next_url


# URL
base_url = "http://www.meigensyu.com/tags/view/"

for category, cat_codes in categories.items():
    for cat_code in cat_codes:
        url = base_url + str(cat_code) + "/" #page1.html

        page = "page1.html"
        while True:
            page = singlePage( url, page, category )
            if page == '':
                break
