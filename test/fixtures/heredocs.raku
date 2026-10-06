# Written for this repository as a smoke test for heredocs. It has to
# parse without error nodes.
use v6.d;

my $plain = q:to/END/;
    Text with $no @interpolation { here }
    and an "unbalanced quote
    END

my $name = 'world';
my $greeting = qq:to/EOT/.trim;
    Hello, $name!
    EOT

sub render(Str $header, Str $body, :$footer = '') {
    join "\n", $header, $body, $footer
}

# Two on one line, and code after each opener.
say render(q:to/HEAD/, q:to/BODY/, footer => 'bye'); # q:to/NOT/ in a comment
    The head
    HEAD
    The body
    BODY

# Around other quotes, regexes and comments that hold `#` and quotes.
my %config = color => <#fff>, pattern => /\#/, note => q{ it's # here },
    text => q:to/END/, flag => True;
    configured
    END

say "mentions q:to/NOPE/ in a string", 'and qq:to/NOPE/ here';
say #`{ an embedded (comment) with q:to/NOPE/ } q:to"END";
    after the comment
    END

# An opener in an interpolation, and the long adverb.
say "list: { q:to/END/.lines.join(', ') }";
    one
    two
    END
say q:heredoc/DONE/, Q:to/RAW/;
    first
    DONE
    second \ $raw
    RAW

class Report {
    has $.title;
    method Str {
        my $text = qq:to/END/;
            Report: $.title
            END
        $text ~ q:to/END/
            (end of report)
            END
    }
}

say Report.new(title => 'Stock').Str;
